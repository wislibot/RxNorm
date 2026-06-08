-- =============================================================================
-- Migration: Add ocr_clean matching pass to rx_match_medication_lines
-- 
-- This adds an intermediate matching pass that uses rx_ocr_clean() to strip
-- OCR noise (CJK prefixes, pharmacy codes, merged digits, parenthetical
-- content) and matches against ingredient tokens with relaxed criteria:
-- only requires ONE substantial token (>= 4 chars) to match, not ALL.
--
-- Also fixes 3 stale test expectations (product_token → product_token_contain)
-- and adds OCR-specific test cases.
-- =============================================================================

-- Drop and recreate rx_match_medication_lines with ocr_cleaned_text added
DROP FUNCTION IF EXISTS public.rx_match_medication_lines(text[]);

CREATE OR REPLACE FUNCTION public.rx_match_medication_lines(medication_lines text[])
RETURNS TABLE (
    input_index int,
    input_text text,
    normalized_text text,
    match_status text,
    ingredient_id uuid,
    ingredient_ids uuid[],
    ingredient_canonical_name text,
    match_method text,
    confidence numeric,
    product_id text,
    product_display_name text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
    with input_lines as (
        select source.ordinality::int - 1 as input_index, source.input_text,
            public.rx_normalize_text(source.input_text) as normalized_text,
            case when position('(' in coalesce(source.input_text,'')) > 0 and position(')' in coalesce(source.input_text,'')) > position('(' in coalesce(source.input_text,''))
                then public.rx_normalize_text(substring(source.input_text from position('(' in source.input_text)+1 for position(')' in source.input_text)-position('(' in source.input_text)-1))
            else null end as paren_normalized_text,
            public.rx_normalize_text(regexp_replace(source.input_text, '[()]', '', 'g')) as product_match_text,
            public.rx_normalize_ocr_spacing(public.rx_strip_dosage_tail(public.rx_normalize_ocr_spacing(source.input_text))) as ocr_normalized_text,
            public.rx_ocr_clean(source.input_text) as ocr_cleaned_text
        from unnest(coalesce(medication_lines,'{}'::text[])) with ordinality as source(input_text, ordinality)
    ),

    -- PASS 1: product_exact — exact product name match via rx_name_variants
    product_exact_candidates as (
        select il.input_index, p.nhi_code as product_id, coalesce(p.name_en,p.name_zh) as product_display_name, pi.ingredient_id, p.effective_start
        from input_lines il
        join public.rx_name_variants nv on nv.target_type='product' and nv.normalized_text=il.product_match_text
        join public.rx_drug_products p on p.nhi_code=nv.target_id
        left join public.rx_product_ingredients pi on pi.nhi_code=p.nhi_code
    ),
    product_exact_unique as (
        select input_index, count(distinct product_id) as candidate_count,
            (array_agg(product_id ORDER BY effective_start DESC nulls last))[1] as product_id,
            (array_agg(product_display_name ORDER BY effective_start DESC nulls last))[1] as product_display_name,
            (array_agg(DISTINCT ingredient_id::text))[1]::uuid as ingredient_id
        from product_exact_candidates group by input_index
    ),

    -- PASS 2: ocr_product — strip dosage, match short brand names against full product names
    ocr_product_candidates as (
        select il.input_index, p.nhi_code as product_id, coalesce(p.name_en,p.name_zh) as product_display_name, pi.ingredient_id, p.effective_start
        from input_lines il
        join public.rx_drug_products p
            on p.ocr_key_en = il.ocr_normalized_text
            or p.ocr_key_zh = il.ocr_normalized_text
        left join public.rx_product_ingredients pi on pi.nhi_code=p.nhi_code
        where il.ocr_normalized_text is not null and length(il.ocr_normalized_text) >= 4
    ),
    ocr_product_unique as (
        select input_index, count(distinct product_id) as candidate_count,
            (array_agg(product_id ORDER BY effective_start DESC nulls last))[1] as product_id,
            (array_agg(product_display_name ORDER BY effective_start DESC nulls last))[1] as product_display_name,
            (array_agg(DISTINCT ingredient_id::text))[1]::uuid as ingredient_id
        from ocr_product_candidates group by input_index
    ),

    -- PASS 3: cjk_fuzzy — CJK near-substring match (allows ≤1 missing character)
    cjk_segments as (
        select il.input_index, public.rx_extract_cjk(il.input_text) as cjk_text
        from input_lines il
        where public.rx_has_cjk(il.input_text) and length(il.input_text) >= 3
    ),
    cjk_candidates as (
        select cs.input_index, nv.target_id as nhi_code, nv.variant_text, p.effective_start
        from cjk_segments cs
        join public.rx_name_variants nv on nv.target_type = 'product'
            and public.rx_has_cjk(nv.variant_text)
            and (exists (select 1 from unnest(string_to_array(cs.cjk_text, ' ')) as seg where length(seg) >= 3 and public.rx_cjk_near_match(seg, nv.variant_text, 1))
                or public.rx_cjk_near_match(cs.cjk_text, nv.variant_text, 1))
        join public.rx_drug_products p on p.nhi_code = nv.target_id
    ),
    cjk_unique as (
        select input_index, count(distinct nhi_code) as candidate_count,
            (array_agg(nhi_code ORDER BY effective_start DESC nulls last))[1] as product_id,
            (array_agg(variant_text ORDER BY effective_start DESC nulls last))[1] as product_display_name
        from cjk_candidates group by input_index having count(distinct nhi_code) <= 3
    ),
    cjk_product_unique as (
        select cu.input_index, cu.candidate_count, cu.product_id, cu.product_display_name,
            (select min(pi.ingredient_id::text)::uuid from public.rx_product_ingredients pi where pi.nhi_code = cu.product_id) as ingredient_id
        from cjk_unique cu
    ),

    -- PASS 4: canonical_exact — ingredient name exact match
    canonical_candidates as (
        select il.input_index, c.ingredient_id, c.canonical_name
        from input_lines il join public.rx_ingredient_concepts c on c.canonical_name_normalized=il.normalized_text
    ),
    canonical_unique as (
        select input_index, count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id, min(canonical_name) as canonical_name
        from canonical_candidates group by input_index
    ),

    -- PASS 5: alias_exact — ingredient alias match
    alias_candidates as (
        select il.input_index, c.ingredient_id, c.canonical_name
        from input_lines il
        join public.rx_name_variants nv on nv.target_type='ingredient' and nv.normalized_text=il.normalized_text
        join public.rx_ingredient_concepts c on c.ingredient_id::text=nv.target_id
    ),
    alias_unique as (
        select input_index, count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id, min(canonical_name) as canonical_name
        from alias_candidates group by input_index
    ),

    -- PASS 6: paren_alias_exact — parenthesized ingredient name match
    paren_candidates as (
        select il.input_index, c.ingredient_id, c.canonical_name
        from input_lines il
        join public.rx_name_variants nv on nv.target_type='ingredient' and nv.normalized_text=il.paren_normalized_text
        join public.rx_ingredient_concepts c on c.ingredient_id::text=nv.target_id
        where il.paren_normalized_text is not null and length(il.paren_normalized_text) >= 3
        union all
        select il.input_index, c.ingredient_id, c.canonical_name
        from input_lines il join public.rx_ingredient_concepts c on c.canonical_name_normalized=il.paren_normalized_text
        where il.paren_normalized_text is not null and length(il.paren_normalized_text) >= 3
    ),
    paren_unique as (
        select input_index, count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id, min(canonical_name) as canonical_name
        from paren_candidates group by input_index
    ),

    -- PASS 7: ocr_clean — cleaned OCR text, single-token match (NEW)
    -- Uses rx_ocr_clean() to strip CJK prefixes, pharmacy codes, merged digits.
    -- Relaxed criteria: only requires ONE token (>= 4 chars) to match.
    ocr_clean_stems as (
        select il.input_index, public.rx_strip_plural_stem(t.token) as stem, t.token as raw_token
        from input_lines il
        cross join lateral unnest(string_to_array(il.ocr_cleaned_text, ' ')) as t(token)
        where coalesce(il.ocr_cleaned_text, '') <> '' and t.token <> '' and length(t.token) >= 4
    ),
    ocr_clean_matches as (
        select distinct ocs.input_index, rit.ingredient_id, c.canonical_name
        from ocr_clean_stems ocs
        join public.rx_ingredient_tokens rit on rit.token_stem = ocs.stem
        join public.rx_ingredient_concepts c on c.ingredient_id = rit.ingredient_id
    ),
    ocr_clean_unique as (
        select input_index, count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name) as canonical_name
        from ocr_clean_matches
        group by input_index
        having count(distinct ingredient_id) = 1
    ),

    -- PASS 8: ingredient_token — token coverage matching (existing)
    token_input_stems as (
        select il.input_index, public.rx_strip_plural_stem(t.token) as stem, t.token as raw_token
        from input_lines il
        cross join lateral unnest(string_to_array(il.normalized_text,' ')) as t(token)
        where coalesce(il.normalized_text,'') <> '' and t.token <> '' and length(t.token) >= 2
    ),
    token_stem_matches as (
        select distinct tis.input_index, rit.ingredient_id
        from token_input_stems tis join public.rx_ingredient_tokens rit on rit.token_stem=tis.stem
    ),
    token_candidate_sigs as (
        select sm.input_index, sm.ingredient_id, c.canonical_name,
            string_agg(tok.token,'|' ORDER BY tok.token) as token_signature
        from token_stem_matches sm
        join public.rx_ingredient_concepts c on c.ingredient_id=sm.ingredient_id
        join public.rx_ingredient_tokens tok on tok.ingredient_id=sm.ingredient_id
        where not exists (
            select 1 from public.rx_ingredient_tokens tok2 where tok2.ingredient_id=sm.ingredient_id
              and not exists (select 1 from token_input_stems tis where tis.input_index=sm.input_index and (tis.stem=tok2.token_stem or tis.raw_token=tok2.token))
        )
        group by sm.input_index, sm.ingredient_id, c.canonical_name
    ),
    token_unique as (
        select input_index, count(distinct token_signature) as candidate_count,
            (array_agg(ingredient_id::text ORDER BY length(canonical_name),canonical_name))[1]::uuid as ingredient_id,
            (array_agg(canonical_name ORDER BY length(canonical_name),canonical_name))[1] as canonical_name
        from (select input_index, ingredient_id, canonical_name, token_signature from token_candidate_sigs) tc
        group by input_index
    ),

    -- PASS 9: product_token_contain — product variant token containment
    input_token_counts as (
        select input_index, count(*) as input_token_count from token_input_stems group by input_index
    ),
    product_contain_scored as (
        select tis.input_index, pvt.nhi_code, count(distinct pvt.token_stem) as matched_tokens, itc.input_token_count
        from token_input_stems tis
        join public.rx_product_variant_tokens pvt on pvt.token_stem=tis.stem
        join input_token_counts itc on itc.input_index=tis.input_index
        group by tis.input_index, pvt.nhi_code, itc.input_token_count
    ),
    product_contain_best as (
        select input_index,
            (array_agg(nhi_code ORDER BY matched_tokens DESC))[1] as product_id,
            (array_agg(matched_tokens ORDER BY matched_tokens DESC))[1] as matched_tokens,
            (array_agg(input_token_count ORDER BY matched_tokens DESC))[1] as input_token_count
        from product_contain_scored
        where matched_tokens::numeric / input_token_count >= 0.60
        group by input_index
    ),
    product_contain_unique as (
        select pcb.input_index, 1::int as candidate_count, pcb.product_id,
            coalesce(p.name_en,p.name_zh) as product_display_name,
            (select min(pi.ingredient_id::text)::uuid from public.rx_product_ingredients pi where pi.nhi_code=pcb.product_id) as ingredient_id
        from product_contain_best pcb join public.rx_drug_products p on p.nhi_code=pcb.product_id
    )

    select il.input_index, il.input_text, il.normalized_text,
        case when peu.candidate_count>=1 then 'matched' when opu.candidate_count>=1 then 'matched' when cku.candidate_count>=1 then 'matched'
            when cu.candidate_count=1 then 'matched' when au.candidate_count=1 then 'matched' when pu.candidate_count=1 then 'matched'
            when ocu.candidate_count=1 then 'matched' when tu.candidate_count=1 then 'matched' when pcu.candidate_count>=1 then 'matched' else 'unmatched' end as match_status,
        case when peu.candidate_count>=1 then peu.ingredient_id when opu.candidate_count>=1 then opu.ingredient_id when cku.candidate_count>=1 then cku.ingredient_id
            when cu.candidate_count=1 then cu.ingredient_id when au.candidate_count=1 then au.ingredient_id when pu.candidate_count=1 then pu.ingredient_id
            when ocu.candidate_count=1 then ocu.ingredient_id when tu.candidate_count=1 then tu.ingredient_id when pcu.candidate_count>=1 then pcu.ingredient_id else null end as ingredient_id,
        case when peu.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=peu.product_id)
            when opu.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=opu.product_id)
            when cku.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=cku.product_id)
            when cu.candidate_count=1 then ARRAY[cu.ingredient_id] when au.candidate_count=1 then ARRAY[au.ingredient_id]
            when pu.candidate_count=1 then ARRAY[pu.ingredient_id] when ocu.candidate_count=1 then ARRAY[ocu.ingredient_id]
            when tu.candidate_count=1 then ARRAY[tu.ingredient_id] when pcu.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=pcu.product_id) else null end as ingredient_ids,
        case when peu.candidate_count>=1 then peu.product_display_name when opu.candidate_count>=1 then opu.product_display_name when cku.candidate_count>=1 then cku.product_display_name
            when cu.candidate_count=1 then cu.canonical_name when au.candidate_count=1 then au.canonical_name when pu.candidate_count=1 then pu.canonical_name
            when ocu.candidate_count=1 then ocu.canonical_name when tu.candidate_count=1 then tu.canonical_name when pcu.candidate_count>=1 then pcu.product_display_name else null end as ingredient_canonical_name,
        case when peu.candidate_count>=1 then 'product_exact' when opu.candidate_count>=1 then 'ocr_product' when cku.candidate_count>=1 then 'cjk_fuzzy'
            when cu.candidate_count=1 then 'canonical_exact' when au.candidate_count=1 then 'alias_exact' when pu.candidate_count=1 then 'paren_alias_exact'
            when ocu.candidate_count=1 then 'ocr_clean' when tu.candidate_count=1 then 'ingredient_token'
            when pcu.candidate_count>=1 then 'product_token_contain' else null end as match_method,
        case when peu.candidate_count>=1 then 0.95 when opu.candidate_count>=1 then 0.90 when cku.candidate_count>=1 then 0.85
            when cu.candidate_count=1 then 0.95 when au.candidate_count=1 then 0.90 when pu.candidate_count=1 then 0.85
            when ocu.candidate_count=1 then 0.70 when tu.candidate_count=1 then 0.65 when pcu.candidate_count>=1 then 0.80 else null end as confidence,
        case when peu.candidate_count>=1 then peu.product_id when opu.candidate_count>=1 then opu.product_id when cku.candidate_count>=1 then cku.product_id
            when pcu.candidate_count>=1 then pcu.product_id else null end as product_id,
        case when peu.candidate_count>=1 then peu.product_display_name when opu.candidate_count>=1 then opu.product_display_name when cku.candidate_count>=1 then cku.product_display_name
            when pcu.candidate_count>=1 then pcu.product_display_name else null end as product_display_name
    from input_lines il
    left join product_exact_unique peu on peu.input_index=il.input_index
    left join ocr_product_unique opu on opu.input_index=il.input_index
    left join cjk_product_unique cku on cku.input_index=il.input_index
    left join canonical_unique cu on cu.input_index=il.input_index
    left join alias_unique au on au.input_index=il.input_index
    left join paren_unique pu on pu.input_index=il.input_index
    left join ocr_clean_unique ocu on ocu.input_index=il.input_index
    left join token_unique tu on tu.input_index=il.input_index
    left join product_contain_unique pcu on pcu.input_index=il.input_index
    order by il.input_index;
$$;

-- =============================================================================
-- Fix 3 stale test expectations: product_token → product_token_contain
-- =============================================================================
CREATE OR REPLACE FUNCTION public.rx_test_match_medication_lines()
RETURNS TABLE (test_name text, passed boolean, detail text)
LANGUAGE plpgsql
AS $$
declare
    v_status text;
    v_method text;
    v_confidence numeric;
    v_ingredient_id uuid;
    v_ingredient_ids uuid[];
    v_canonical text;
    v_product_id text;
begin
    -- TEST 1: Combo drug matches product via token containment
    select match_status, match_method, confidence, product_id into v_status, v_method, v_confidence, v_product_id
    from public.rx_match_medication_lines(ARRAY['Linagliptin & Metformin 850mg']);
    test_name := 'combo_drug_matches_product';
    passed := (v_status = 'matched' and v_method = 'product_token_contain' and v_product_id is not null);
    detail := format('status=%s method=%s product=%s', v_status, v_method, v_product_id);
    return next;

    -- TEST 2: Plural token pass — 'Sennosides 12mg' matches SENNOSIDE
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Sennosides 12mg']);
    test_name := 'token_plural_unique_sennoside_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 3: Canonical exact takes precedence over token
    select match_status, match_method, confidence, ingredient_id, ingredient_ids
    into v_status, v_method, v_confidence, v_ingredient_id, v_ingredient_ids
    from public.rx_match_medication_lines(ARRAY['OMEPRAZOLE']);
    test_name := 'canonical_exact_precedence';
    passed := (v_status = 'matched' and v_method = 'canonical_exact' and v_confidence = 0.95
        and v_ingredient_ids = ARRAY[v_ingredient_id]);
    detail := format('status=%s method=%s ingredient_ids=%s', v_status, v_method, v_ingredient_ids);
    return next;

    -- TEST 4: Paren precedence over token
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['60puff/bot(tiotropium)']);
    test_name := 'paren_precedence_over_token';
    passed := (v_status = 'matched' and v_method = 'paren_alias_exact' and v_confidence = 0.85);
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 5: Token pass for unique ingredient
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Omeprazole 20mg']);
    test_name := 'token_unique_omeprazole_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_confidence = 0.65);
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 6: Plural matching
    select match_status, match_method, ingredient_canonical_name
    into v_status, v_method, v_canonical
    from public.rx_match_medication_lines(ARRAY['Sennosides 2mg']);
    test_name := 'token_plural_sennosides_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 7: Combo ingredient names match product via token containment
    select match_status, match_method, product_id
    into v_status, v_method, v_product_id
    from public.rx_match_medication_lines(ARRAY['Linagliptin & Metformin']);
    test_name := 'combo_ingredient_names_match_product';
    passed := (v_status = 'matched' and v_method = 'product_token_contain' and v_product_id is not null);
    detail := format('status=%s method=%s product=%s', v_status, v_method, v_product_id);
    return next;

    -- TEST 8: Token pass works for unique ingredient
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Acarbose 50mg']);
    test_name := 'token_unique_acarbose_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_confidence = 0.65);
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 9: Unmatched for unknown ingredient
    select match_status, ingredient_id into v_status, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Xyzalol 999mg']);
    test_name := 'unmatched_unknown_ingredient';
    passed := (v_status = 'unmatched' and v_ingredient_id is null);
    detail := format('status=%s', v_status);
    return next;

    -- TEST 10: Empty input returns empty result
    test_name := 'empty_input';
    passed := (select count(*) from public.rx_match_medication_lines(ARRAY[]::text[])) = 0;
    detail := 'empty array returns no rows';
    return next;

    -- TEST 11: Trajenta DUO matches via product_token_contain with all ingredients
    select match_status, match_method, confidence, product_id, ingredient_ids
    into v_status, v_method, v_confidence, v_product_id, v_ingredient_ids
    from public.rx_match_medication_lines(ARRAY['Trajenta DUO 2.5& 850mg']);
    test_name := 'product_token_trajenta_duo_has_all_ingredients';
    passed := (v_status = 'matched' and v_method = 'product_token_contain' and v_product_id = 'BC25792100'
        and v_ingredient_ids is not null and array_length(v_ingredient_ids, 1) >= 2);
    detail := format('status=%s method=%s product=%s ingredient_ids=%s', v_status, v_method, v_product_id, v_ingredient_ids);
    return next;

    -- TEST 12: Chinese product name matches via product_exact
    select match_status, match_method, confidence, product_id, ingredient_ids
    into v_status, v_method, v_confidence, v_product_id, v_ingredient_ids
    from public.rx_match_medication_lines(ARRAY['糖倍平 膜衣錠 2.5/850 毫克']);
    test_name := 'product_exact_chinese_has_all_ingredients';
    passed := (v_status = 'matched' and v_method = 'product_exact' and v_product_id = 'BC25792100'
        and v_ingredient_ids is not null and array_length(v_ingredient_ids, 1) >= 2);
    detail := format('status=%s method=%s product=%s ingredient_ids=%s', v_status, v_method, v_product_id, v_ingredient_ids);
    return next;

    -- TEST 13: OCR clean — AMOXYCILLIN (spelling variant) matches via ocr_clean
    select match_status, match_method, ingredient_canonical_name
    into v_status, v_method, v_canonical
    from public.rx_match_medication_lines(ARRAY['AMOXYCILLIN (T CUR33']);
    test_name := 'ocr_clean_amoxycillin_spelling';
    passed := (v_status = 'matched' and v_canonical IS NOT NULL);
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 14: OCR clean — LEVOCETIRIZINE (salt form stripped) matches via ocr_clean
    select match_status, match_method, ingredient_canonical_name
    into v_status, v_method, v_canonical
    from public.rx_match_medication_lines(ARRAY['LEVOCETIRIZINE XYZ']);
    test_name := 'ocr_clean_levocetirizine_stripped';
    passed := (v_status = 'matched' and v_canonical IS NOT NULL);
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 15: OCR clean — CJK prefix + truncation (BENPROPERI) matches
    select match_status, match_method, ingredient_canonical_name
    into v_status, v_method, v_canonical
    from public.rx_match_medication_lines(ARRAY[chr(21338)||chr(20840)||'BENPROPERI NOR']);
    test_name := 'ocr_clean_cjk_prefix_truncated';
    passed := (v_status = 'matched' and v_canonical IS NOT NULL);
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;
end;
$$;
