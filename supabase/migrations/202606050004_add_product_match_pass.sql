-- Add product-level matching as first pass in rx_match_medication_lines
--
-- PROBLEM: Combo drugs like "Trajenta DUO 2.5/850mg" contain 2+ ingredients,
-- so the combo guard rejects them. But the product exists in rx_drug_products
-- with name variants in rx_name_variants (target_type = 'product').
--
-- FIX: Add 2 product passes BEFORE ingredient passes:
--   Pass 1: product_exact  (0.95) — normalized text matches product name variant
--   Pass 2: product_token  (0.70) — all product name variant tokens covered by input
--   Pass 3: canonical_exact  (0.95) — unchanged
--   Pass 4: alias_exact      (0.90) — unchanged
--   Pass 5: paren_alias      (0.85) — unchanged
--   Pass 6: ingredient_token (0.65) — unchanged
--
-- Product matches bypass the combo guard: the product IS the match.
-- ingredient_id is the first row from rx_product_ingredients (for backwards compat).
-- ingredient_ids is ALL rows from rx_product_ingredients (for combo drugs).

drop function if exists public.rx_match_medication_lines(text[]);

create or replace function public.rx_match_medication_lines(medication_lines text[])
returns table (
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
language sql
security invoker
set search_path = public
as $$
    with input_lines as (
        select
            source.ordinality::int - 1 as input_index,
            source.input_text,
            public.rx_normalize_text(source.input_text) as normalized_text,
            case
                when position('(' in coalesce(source.input_text, '')) > 0
                 and position(')' in coalesce(source.input_text, '')) > position('(' in coalesce(source.input_text, ''))
                    then public.rx_normalize_text(
                        substring(source.input_text from position('(' in source.input_text) + 1 for
                            position(')' in source.input_text) - position('(' in source.input_text) - 1))
                else null
            end as paren_normalized_text,
            -- For product matching: strip parenthesized content + CJK
            public.rx_normalize_text(
                regexp_replace(source.input_text, '\\([^)]*\\)', '', 'g')
            ) as product_match_text
        from unnest(coalesce(medication_lines, '{}'::text[])) with ordinality as source(input_text, ordinality)
    ),

    -- =========================================================================
    -- Pass 1: product exact match
    -- =========================================================================
    product_exact_candidates as (
        select
            il.input_index,
            p.nhi_code as product_id,
            coalesce(p.name_en, p.name_zh) as product_display_name,
            pi.ingredient_id
        from input_lines il
        join public.rx_name_variants nv
            on nv.target_type = 'product'
           and nv.normalized_text = il.product_match_text
        join public.rx_drug_products p
            on p.nhi_code = nv.target_id
        left join public.rx_product_ingredients pi
            on pi.nhi_code = p.nhi_code
        group by il.input_index, p.nhi_code, coalesce(p.name_en, p.name_zh), pi.ingredient_id
    ),
    product_exact_unique as (
        select
            input_index,
            count(distinct product_id) as candidate_count,
            min(product_id) as product_id,
            min(product_display_name) as product_display_name,
            min(ingredient_id::text)::uuid as ingredient_id
        from product_exact_candidates
        group by input_index
    ),

    -- =========================================================================
    -- Pass 2: product token match
    -- For EACH product name variant independently: all variant tokens must be
    -- covered by input tokens. If ANY variant is fully covered, the product
    -- matches. Same logic as ingredient token pass but per-variant.
    -- =========================================================================
    product_token_input_stems as (
        select
            il.input_index,
            public.rx_strip_plural_stem(t.token) as stem,
            t.token as raw_token
        from input_lines il
        cross join lateral unnest(string_to_array(il.normalized_text, ' ')) as t(token)
        where coalesce(il.normalized_text, '') <> ''
          and t.token <> ''
          and length(t.token) >= 2
    ),
    -- Each variant's tokens, per (product, variant)
    product_variant_tokens as (
        select
            nv.target_id as nhi_code,
            nv.variant_id,
            public.rx_strip_plural_stem(nvt.token) as token_stem,
            nvt.token as raw_token
        from public.rx_name_variants nv
        cross join lateral unnest(string_to_array(nv.normalized_text, ' ')) as nvt(token)
        where nv.target_type = 'product'
          and nvt.token <> ''
          and length(nvt.token) >= 2
    ),
    -- Check coverage per variant: all variant tokens ⊂ input tokens
    product_variant_coverage as (
        select
            ptis.input_index,
            pvt.nhi_code,
            pvt.variant_id
        from product_token_input_stems ptis
        join product_variant_tokens pvt
            on true  -- cross join: check every variant against every input
        group by ptis.input_index, pvt.nhi_code, pvt.variant_id
        having not exists (
            select 1
            from product_variant_tokens pvt2
            where pvt2.variant_id = pvt.variant_id
              and not exists (
                  select 1
                  from product_token_input_stems ptis2
                  where ptis2.input_index = ptis.input_index
                    and (ptis2.stem = pvt2.token_stem or ptis2.raw_token = pvt2.raw_token)
              )
        )
    ),
    -- Deduplicate: one row per (input_index, product) if ANY variant matched
    product_token_dedup as (
        select
            input_index,
            nhi_code,
            count(distinct variant_id) as matched_variants
        from product_variant_coverage
        group by input_index, nhi_code
    ),
    product_token_unique as (
        select
            ptd.input_index,
            count(distinct ptd.nhi_code) as candidate_count,
            min(ptd.nhi_code) as product_id,
            min(coalesce(p.name_en, p.name_zh)) as product_display_name
        from product_token_dedup ptd
        join public.rx_drug_products p on p.nhi_code = ptd.nhi_code
        group by ptd.input_index
    ),

    -- =========================================================================
    -- Pass 3: canonical exact (unchanged)
    -- =========================================================================
    canonical_candidates as (
        select
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        from input_lines il
        join public.rx_ingredient_concepts c
            on c.canonical_name_normalized = il.normalized_text
    ),
    canonical_unique as (
        select
            input_index,
            count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name) as canonical_name
        from canonical_candidates
        group by input_index
    ),

    -- =========================================================================
    -- Pass 4: alias exact (unchanged)
    -- =========================================================================
    alias_candidates as (
        select
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        from input_lines il
        join public.rx_name_variants nv
            on nv.target_type = 'ingredient'
           and nv.normalized_text = il.normalized_text
        join public.rx_ingredient_concepts c
            on c.ingredient_id::text = nv.target_id
    ),
    alias_unique as (
        select
            input_index,
            count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name) as canonical_name
        from alias_candidates
        group by input_index
    ),

    -- =========================================================================
    -- Pass 5: paren alias (unchanged)
    -- =========================================================================
    paren_candidates as (
        select
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        from input_lines il
        join public.rx_name_variants nv
            on nv.target_type = 'ingredient'
           and nv.normalized_text = il.paren_normalized_text
        join public.rx_ingredient_concepts c
            on c.ingredient_id::text = nv.target_id
        where il.paren_normalized_text is not null
          and length(il.paren_normalized_text) >= 3

        union all

        select
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        from input_lines il
        join public.rx_ingredient_concepts c
            on c.canonical_name_normalized = il.paren_normalized_text
        where il.paren_normalized_text is not null
          and length(il.paren_normalized_text) >= 3
    ),
    paren_unique as (
        select
            input_index,
            count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name) as canonical_name
        from paren_candidates
        group by input_index
    ),

    -- =========================================================================
    -- Pass 6: ingredient token match (unchanged)
    -- =========================================================================
    token_input_stems as (
        select
            il.input_index,
            public.rx_strip_plural_stem(t.token) as stem,
            t.token as raw_token
        from input_lines il
        cross join lateral unnest(string_to_array(il.normalized_text, ' ')) as t(token)
        where coalesce(il.normalized_text, '') <> ''
          and t.token <> ''
          and length(t.token) >= 2
    ),
    token_stem_matches as (
        select distinct
            tis.input_index,
            rit.ingredient_id
        from token_input_stems tis
        join public.rx_ingredient_tokens rit
            on rit.token_stem = tis.stem
    ),
    token_candidate_sigs as (
        select
            sm.input_index,
            sm.ingredient_id,
            c.canonical_name,
            string_agg(tok.token, '|' ORDER BY tok.token) as token_signature
        from token_stem_matches sm
        join public.rx_ingredient_concepts c
            on c.ingredient_id = sm.ingredient_id
        join public.rx_ingredient_tokens tok
            on tok.ingredient_id = sm.ingredient_id
        where not exists (
            select 1
            from public.rx_ingredient_tokens tok2
            where tok2.ingredient_id = sm.ingredient_id
              and not exists (
                  select 1
                  from token_input_stems tis
                  where tis.input_index = sm.input_index
                    and (tis.stem = tok2.token_stem or tis.raw_token = tok2.token)
              )
        )
        group by sm.input_index, sm.ingredient_id, c.canonical_name
    ),
    token_candidates as (
        select
            input_index,
            ingredient_id,
            canonical_name,
            token_signature
        from token_candidate_sigs
    ),
    token_unique as (
        select
            input_index,
            count(distinct token_signature) as candidate_count,
            (array_agg(ingredient_id::text ORDER BY length(canonical_name), canonical_name))[1]::uuid as ingredient_id,
            (array_agg(canonical_name ORDER BY length(canonical_name), canonical_name))[1] as canonical_name
        from token_candidates
        group by input_index
    )

    select
        il.input_index,
        il.input_text,
        il.normalized_text,
        case
            when peu.candidate_count = 1 then 'matched'
            when ptu.candidate_count = 1 then 'matched'
            when cu.candidate_count = 1 then 'matched'
            when au.candidate_count = 1 then 'matched'
            when pu.candidate_count = 1 then 'matched'
            when tu.candidate_count = 1 then 'matched'
            else 'unmatched'
        end as match_status,
        case
            when peu.candidate_count = 1 then peu.ingredient_id
            when ptu.candidate_count = 1 then (
                select pi.ingredient_id
                from public.rx_product_ingredients pi
                where pi.nhi_code = ptu.product_id
                order by pi.ingredient_id
                limit 1
            )
            when cu.candidate_count = 1 then cu.ingredient_id
            when au.candidate_count = 1 then au.ingredient_id
            when pu.candidate_count = 1 then pu.ingredient_id
            when tu.candidate_count = 1 then tu.ingredient_id
            else null
        end as ingredient_id,
        case
            when peu.candidate_count = 1 then (
                select array_agg(pi.ingredient_id ORDER BY pi.ingredient_id)
                from public.rx_product_ingredients pi
                where pi.nhi_code = peu.product_id
            )
            when ptu.candidate_count = 1 then (
                select array_agg(pi.ingredient_id ORDER BY pi.ingredient_id)
                from public.rx_product_ingredients pi
                where pi.nhi_code = ptu.product_id
            )
            when cu.candidate_count = 1 then ARRAY[cu.ingredient_id]
            when au.candidate_count = 1 then ARRAY[au.ingredient_id]
            when pu.candidate_count = 1 then ARRAY[pu.ingredient_id]
            when tu.candidate_count = 1 then ARRAY[tu.ingredient_id]
            else null
        end as ingredient_ids,
        case
            when peu.candidate_count = 1 then peu.product_display_name
            when ptu.candidate_count = 1 then ptu.product_display_name
            when cu.candidate_count = 1 then cu.canonical_name
            when au.candidate_count = 1 then au.canonical_name
            when pu.candidate_count = 1 then pu.canonical_name
            when tu.candidate_count = 1 then tu.canonical_name
            else null
        end as ingredient_canonical_name,
        case
            when peu.candidate_count = 1 then 'product_exact'
            when ptu.candidate_count = 1 then 'product_token'
            when cu.candidate_count = 1 then 'canonical_exact'
            when au.candidate_count = 1 then 'alias_exact'
            when pu.candidate_count = 1 then 'paren_alias_exact'
            when tu.candidate_count = 1 then 'ingredient_token'
            else null
        end as match_method,
        case
            when peu.candidate_count = 1 then 0.95
            when ptu.candidate_count = 1 then 0.70
            when cu.candidate_count = 1 then 0.95
            when au.candidate_count = 1 then 0.90
            when pu.candidate_count = 1 then 0.85
            when tu.candidate_count = 1 then 0.65
            else null
        end as confidence,
        case
            when peu.candidate_count = 1 then peu.product_id
            when ptu.candidate_count = 1 then ptu.product_id
            else null
        end as product_id,
        case
            when peu.candidate_count = 1 then peu.product_display_name
            when ptu.candidate_count = 1 then ptu.product_display_name
            else null
        end as product_display_name
    from input_lines il
    left join product_exact_unique peu on peu.input_index = il.input_index
    left join product_token_unique ptu on ptu.input_index = il.input_index
    left join canonical_unique cu on cu.input_index = il.input_index
    left join alias_unique au on au.input_index = il.input_index
    left join paren_unique pu on pu.input_index = il.input_index
    left join token_unique tu on tu.input_index = il.input_index
    order by il.input_index;
$$;


-- =============================================================================
-- TESTS: rx_match_medication_lines (with product passes)
-- =============================================================================
-- Run with: SELECT * FROM rx_test_match_medication_lines();

create or replace function public.rx_test_match_medication_lines()
returns table (test_name text, passed boolean, detail text)
language plpgsql
as $$
declare
    v_status text;
    v_method text;
    v_confidence numeric;
    v_ingredient_id uuid;
    v_ingredient_ids uuid[];
    v_canonical text;
    v_product_id text;
    v_product_name text;
begin
    -- TEST 1: COMBO GUARD (critical safety) — two ingredients, no brand name
    select match_status, match_method, ingredient_id
    into v_status, v_method, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Linagliptin & Metformin 850mg']);

    test_name := 'combo_guard_two_ingredients';
    passed := (v_status = 'unmatched' and v_ingredient_id is null);
    detail := format('status=%s method=%s ingredient_id=%s', v_status, v_method, v_ingredient_id);
    return next;

    -- TEST 2: Plural token pass — 'Sennosides 12mg' matches SENNOSIDE
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Sennosides 12mg']);

    test_name := 'token_plural_unique_sennoside_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- TEST 3: Canonical exact takes precedence over token
    select match_status, match_method, confidence, ingredient_id, ingredient_ids
    into v_status, v_method, v_confidence, v_ingredient_id, v_ingredient_ids
    from public.rx_match_medication_lines(ARRAY['OMEPRAZOLE']);

    test_name := 'canonical_exact_precedence';
    passed := (v_status = 'matched'
        and v_method = 'canonical_exact'
        and v_confidence = 0.95
        and v_ingredient_ids = ARRAY[v_ingredient_id]);
    detail := format('status=%s method=%s confidence=%s ingredient_ids=%s', v_status, v_method, v_confidence, v_ingredient_ids);
    return next;

    -- TEST 4: Paren precedence over token
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['60puff/bot(tiotropium)']);

    test_name := 'paren_precedence_over_token';
    passed := (v_status = 'matched' and v_method = 'paren_alias_exact' and v_confidence = 0.85);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- TEST 5: Token pass for unique ingredient
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Omeprazole 20mg']);

    test_name := 'token_unique_omeprazole_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_confidence = 0.65);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- TEST 6: Plural matching
    select match_status, match_method, ingredient_canonical_name
    into v_status, v_method, v_canonical
    from public.rx_match_medication_lines(ARRAY['Sennosides 2mg']);

    test_name := 'token_plural_sennosides_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- TEST 7: Combo guard with two ingredient tokens (no brand name) — still unmatched
    select match_status, ingredient_id
    into v_status, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Linagliptin & Metformin']);

    test_name := 'combo_guard_two_ingredient_tokens';
    passed := (v_status = 'unmatched' and v_ingredient_id is null);
    detail := format('status=%s ingredient_id=%s', v_status, v_ingredient_id);
    return next;

    -- TEST 8: Token pass works for unique ingredient
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Acarbose 50mg']);

    test_name := 'token_unique_acarbose_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_confidence = 0.65);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- TEST 9: Unmatched for unknown ingredient
    select match_status, ingredient_id
    into v_status, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Xyzalol 999mg']);

    test_name := 'unmatched_unknown_ingredient';
    passed := (v_status = 'unmatched' and v_ingredient_id is null);
    detail := format('status=%s ingredient_id=%s', v_status, v_ingredient_id);
    return next;

    -- TEST 10: Empty input returns empty result
    test_name := 'empty_input';
    passed := (select count(*) from public.rx_match_medication_lines(ARRAY[]::text[])) = 0;
    detail := 'empty array returns no rows';
    return next;

    -- TEST 11: Product exact match — 'Trajenta DUO 2.5& 850mg' matches BC25792100
    select match_status, match_method, confidence, product_id, ingredient_canonical_name, ingredient_ids
    into v_status, v_method, v_confidence, v_product_id, v_canonical, v_ingredient_ids
    from public.rx_match_medication_lines(ARRAY['Trajenta DUO 2.5& 850mg']);

    test_name := 'product_exact_trajenta_duo_matches';
    passed := (v_status = 'matched'
        and v_method = 'product_exact'
        and v_confidence = 0.95
        and v_product_id = 'BC25792100'
        and v_canonical = 'Trajenta Duo 2.5/850mg Film-Coated Tablets'
        and v_ingredient_ids is not null
        and array_length(v_ingredient_ids, 1) >= 2);
    detail := format('status=%s method=%s confidence=%s product=%s ingredient_ids=%s',
        v_status, v_method, v_confidence, v_product_id, v_ingredient_ids);
    return next;

    -- TEST 12: Product exact match — Chinese name matches same product
    select match_status, match_method, confidence, product_id, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_product_id, v_canonical
    from public.rx_match_medication_lines(ARRAY['糖倍平 膜衣錠 2.5/850 毫克']);

    test_name := 'product_exact_chinese_name_matches';
    passed := (v_status = 'matched'
        and v_method = 'product_exact'
        and v_confidence = 0.95
        and v_product_id = 'BC25792100');
    detail := format('status=%s method=%s confidence=%s product=%s canonical=%s',
        v_status, v_method, v_confidence, v_product_id, v_canonical);
    return next;
end;
$$;
