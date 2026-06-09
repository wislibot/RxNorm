-- rx_match_medication_lines v41: return one row per matched ingredient
-- When OCR merges 2+ drugs into one line, produce multiple rows.
-- Simplified approach: just unnest the final ingredient_ids array.

DROP FUNCTION IF EXISTS public.rx_match_medication_lines(text[]);

CREATE OR REPLACE FUNCTION public.rx_match_medication_lines(medication_lines text[])
 RETURNS TABLE(input_index integer, input_text text, normalized_text text, match_status text, ingredient_id uuid, ingredient_ids uuid[], ingredient_canonical_name text, match_method text, confidence numeric, product_id text, product_display_name text)
 LANGUAGE sql
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
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
        where source.ordinality <= 15
    ),
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
    canonical_candidates as (
        select il.input_index, c.ingredient_id, c.canonical_name
        from input_lines il join public.rx_ingredient_concepts c on c.canonical_name_normalized=il.normalized_text
    ),
    canonical_unique as (
        select input_index, count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id, min(canonical_name) as canonical_name
        from canonical_candidates group by input_index
    ),
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
    ),
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
            (array_agg(ingredient_id::text ORDER BY length(canonical_name), canonical_name))[1]::uuid as ingredient_id,
            (array_agg(canonical_name ORDER BY length(canonical_name), canonical_name))[1] as canonical_name
        from ocr_clean_matches
        group by input_index
        having count(distinct ingredient_id) <= 50
    ),
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
    -- Per-line best match with ALL ingredient_ids computed
    line_matches as (
        select il.input_index, il.input_text, il.normalized_text,
            case when peu.candidate_count>=1 then 'product_exact'
                 when opu.candidate_count>=1 then 'ocr_product'
                 when cu.candidate_count=1 then 'canonical_exact'
                 when au.candidate_count=1 then 'alias_exact'
                 when pu.candidate_count=1 then 'paren_alias_exact'
                 when tu.candidate_count=1 then 'ingredient_token'
                 when pcu.candidate_count>=1 then 'product_token_contain'
                 when ocu.candidate_count>=1 then 'ocr_clean'
                 when cku.candidate_count>=1 then 'cjk_fuzzy'
                 else null end as match_method,
            case when peu.candidate_count>=1 then peu.product_id
                 when opu.candidate_count>=1 then opu.product_id
                 when pcu.candidate_count>=1 then pcu.product_id
                 when cku.candidate_count>=1 then cku.product_id else null end as product_id,
            case when peu.candidate_count>=1 then peu.product_display_name
                 when opu.candidate_count>=1 then opu.product_display_name
                 when pcu.candidate_count>=1 then pcu.product_display_name
                 when cku.candidate_count>=1 then cku.product_display_name else null end as product_display_name,
            -- For product-level passes: get ALL ingredients from the product
            -- For ocr_clean: get ALL matching ingredients from the line
            -- For single-ingredient passes: just the one ingredient
            coalesce(
                -- Product passes: all ingredients of that product
                case when peu.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=peu.product_id)
                     when opu.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=opu.product_id)
                     when cku.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=cku.product_id)
                     when pcu.candidate_count>=1 then (select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id) from public.rx_product_ingredients pi where pi.nhi_code=pcu.product_id)
                     end,
                -- ocr_clean: ALL ingredients that matched from this line
                case when ocu.candidate_count>=1 then
                    (select array_agg(DISTINCT ocm.ingredient_id ORDER BY ocm.ingredient_id) from ocr_clean_matches ocm where ocm.input_index=il.input_index)
                     end,
                -- Single-ingredient passes
                case when cu.candidate_count=1 then ARRAY[cu.ingredient_id]
                     when au.candidate_count=1 then ARRAY[au.ingredient_id]
                     when pu.candidate_count=1 then ARRAY[pu.ingredient_id]
                     when tu.candidate_count=1 then ARRAY[tu.ingredient_id]
                     end
            ) as all_ingredient_ids
        from input_lines il
        left join product_exact_unique peu on peu.input_index=il.input_index
        left join ocr_product_unique opu on opu.input_index=il.input_index
        left join canonical_unique cu on cu.input_index=il.input_index
        left join alias_unique au on au.input_index=il.input_index
        left join paren_unique pu on pu.input_index=il.input_index
        left join token_unique tu on tu.input_index=il.input_index
        left join product_contain_unique pcu on pcu.input_index=il.input_index
        left join ocr_clean_unique ocu on ocu.input_index=il.input_index
        left join cjk_product_unique cku on cku.input_index=il.input_index
    )
    -- Final: unnest all_ingredient_ids to produce one row per ingredient
    select lm.input_index, lm.input_text, lm.normalized_text,
        case when exp.id is not null then 'matched'
             when lm.match_method is null then 'unmatched'
             else 'matched' end as match_status,
        exp.id as ingredient_id,
        lm.all_ingredient_ids as ingredient_ids,
        coalesce(
            (select ic.canonical_name from public.rx_ingredient_concepts ic where ic.ingredient_id = exp.id),
            lm.product_display_name
        ) as ingredient_canonical_name,
        lm.match_method,
        case when lm.match_method = 'product_exact' then 0.95
             when lm.match_method = 'ocr_product' then 0.90
             when lm.match_method = 'canonical_exact' then 0.95
             when lm.match_method = 'alias_exact' then 0.90
             when lm.match_method = 'paren_alias_exact' then 0.85
             when lm.match_method = 'ingredient_token' then 0.65
             when lm.match_method = 'product_token_contain' then 0.80
             when lm.match_method = 'ocr_clean' then 0.70
             when lm.match_method = 'cjk_fuzzy' then 0.85
             else null end as confidence,
        lm.product_id,
        lm.product_display_name
    from line_matches lm
    left join lateral unnest(lm.all_ingredient_ids) as exp(id) on true
    order by lm.input_index, exp.id;
$function$;

SELECT pg_notify('pgrst', 'reload schema');
