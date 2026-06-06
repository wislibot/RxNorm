-- v32: Add OCR-aware product matching, remove slow product_token cross-join
--
-- CHANGES from previous version:
-- 1. REMOVED: product_token pass (cross-join of 89k product name variants caused
--    30s+ query times on Supabase free tier)
-- 2. ADDED: ocr_product pass using rx_strip_dosage_tail + rx_normalize_ocr_spacing
--    (same normalization as rx_match_brand_lines). Matches short OCR brand names
--    against full product names.
-- 3. FIXED: Product passes now use >= 1 candidate_count instead of = 1, and pick
--    the most recent product by effective_start when multiple license variants exist.
-- 4. ingredient_ids[] now uses DISTINCT to avoid duplicate entries from multi-row
--    rx_product_ingredients.
--
-- PERFORMANCE: ~2s per call (was 30s+ with product_token cross-join)

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
            public.rx_normalize_text(
                regexp_replace(source.input_text, '[()]', '', 'g')
            ) as product_match_text,
            public.rx_normalize_ocr_spacing(
                public.rx_strip_dosage_tail(
                    public.rx_normalize_ocr_spacing(source.input_text)
                )
            ) as ocr_normalized_text
        from unnest(coalesce(medication_lines, '{}'::text[])) with ordinality as source(input_text, ordinality)
    ),

    -- =========================================================================
    -- Pass 1: product exact match (via rx_name_variants)
    -- =========================================================================
    product_exact_candidates as (
        select
            il.input_index,
            p.nhi_code as product_id,
            coalesce(p.name_en, p.name_zh) as product_display_name,
            pi.ingredient_id,
            p.effective_start
        from input_lines il
        join public.rx_name_variants nv
            on nv.target_type = 'product'
           and nv.normalized_text = il.product_match_text
        join public.rx_drug_products p
            on p.nhi_code = nv.target_id
        left join public.rx_product_ingredients pi
            on pi.nhi_code = p.nhi_code
    ),
    product_exact_unique as (
        select
            input_index,
            count(distinct product_id) as candidate_count,
            (array_agg(product_id ORDER BY effective_start DESC nulls last))[1] as product_id,
            (array_agg(product_display_name ORDER BY effective_start DESC nulls last))[1] as product_display_name,
            (array_agg(DISTINCT ingredient_id::text))[1]::uuid as ingredient_id
        from product_exact_candidates
        group by input_index
    ),

    -- =========================================================================
    -- Pass 2: OCR-aware product match
    -- Uses rx_strip_dosage_tail + rx_normalize_ocr_spacing to match short OCR
    -- input against full product names. E.g. "Spiriva Respimat" matches
    -- "Spiriva Respimat 2.5mcg, Solution for Inhalation".
    -- When multiple license variants exist, picks the most recent one.
    -- =========================================================================
    ocr_product_candidates as (
        select
            il.input_index,
            p.nhi_code as product_id,
            coalesce(p.name_en, p.name_zh) as product_display_name,
            pi.ingredient_id,
            p.effective_start
        from input_lines il
        join public.rx_drug_products p
            on public.rx_normalize_ocr_spacing(
                    public.rx_strip_dosage_tail(coalesce(p.name_en, ''))
                ) = il.ocr_normalized_text
            or public.rx_normalize_ocr_spacing(
                    public.rx_strip_dosage_tail(coalesce(p.name_zh, ''))
                ) = il.ocr_normalized_text
        left join public.rx_product_ingredients pi
            on pi.nhi_code = p.nhi_code
        where il.ocr_normalized_text is not null
          and length(il.ocr_normalized_text) >= 4
    ),
    ocr_product_unique as (
        select
            input_index,
            count(distinct product_id) as candidate_count,
            (array_agg(product_id ORDER BY effective_start DESC nulls last))[1] as product_id,
            (array_agg(product_display_name ORDER BY effective_start DESC nulls last))[1] as product_display_name,
            (array_agg(DISTINCT ingredient_id::text))[1]::uuid as ingredient_id
        from ocr_product_candidates
        group by input_index
    ),

    -- =========================================================================
    -- Pass 3: canonical exact match
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
    -- Pass 4: alias exact match
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
    -- Pass 5: paren alias match
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
    -- Pass 6: ingredient token match (indexed lookup)
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
            when peu.candidate_count >= 1 then 'matched'
            when opu.candidate_count >= 1 then 'matched'
            when cu.candidate_count = 1 then 'matched'
            when au.candidate_count = 1 then 'matched'
            when pu.candidate_count = 1 then 'matched'
            when tu.candidate_count = 1 then 'matched'
            else 'unmatched'
        end as match_status,
        case
            when peu.candidate_count >= 1 then peu.ingredient_id
            when opu.candidate_count >= 1 then opu.ingredient_id
            when cu.candidate_count = 1 then cu.ingredient_id
            when au.candidate_count = 1 then au.ingredient_id
            when pu.candidate_count = 1 then pu.ingredient_id
            when tu.candidate_count = 1 then tu.ingredient_id
            else null
        end as ingredient_id,
        case
            when peu.candidate_count >= 1 then (
                select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id)
                from public.rx_product_ingredients pi
                where pi.nhi_code = peu.product_id
            )
            when opu.candidate_count >= 1 then (
                select array_agg(DISTINCT pi.ingredient_id ORDER BY pi.ingredient_id)
                from public.rx_product_ingredients pi
                where pi.nhi_code = opu.product_id
            )
            when cu.candidate_count = 1 then ARRAY[cu.ingredient_id]
            when au.candidate_count = 1 then ARRAY[au.ingredient_id]
            when pu.candidate_count = 1 then ARRAY[pu.ingredient_id]
            when tu.candidate_count = 1 then ARRAY[tu.ingredient_id]
            else null
        end as ingredient_ids,
        case
            when peu.candidate_count >= 1 then peu.product_display_name
            when opu.candidate_count >= 1 then opu.product_display_name
            when cu.candidate_count = 1 then cu.canonical_name
            when au.candidate_count = 1 then au.canonical_name
            when pu.candidate_count = 1 then pu.canonical_name
            when tu.candidate_count = 1 then tu.canonical_name
            else null
        end as ingredient_canonical_name,
        case
            when peu.candidate_count >= 1 then 'product_exact'
            when opu.candidate_count >= 1 then 'ocr_product'
            when cu.candidate_count = 1 then 'canonical_exact'
            when au.candidate_count = 1 then 'alias_exact'
            when pu.candidate_count = 1 then 'paren_alias_exact'
            when tu.candidate_count = 1 then 'ingredient_token'
            else null
        end as match_method,
        case
            when peu.candidate_count >= 1 then 0.95
            when opu.candidate_count >= 1 then 0.90
            when cu.candidate_count = 1 then 0.95
            when au.candidate_count = 1 then 0.90
            when pu.candidate_count = 1 then 0.85
            when tu.candidate_count = 1 then 0.65
            else null
        end as confidence,
        case
            when peu.candidate_count >= 1 then peu.product_id
            when opu.candidate_count >= 1 then opu.product_id
            else null
        end as product_id,
        case
            when peu.candidate_count >= 1 then peu.product_display_name
            when opu.candidate_count >= 1 then opu.product_display_name
            else null
        end as product_display_name
    from input_lines il
    left join product_exact_unique peu on peu.input_index = il.input_index
    left join ocr_product_unique opu on opu.input_index = il.input_index
    left join canonical_unique cu on cu.input_index = il.input_index
    left join alias_unique au on au.input_index = il.input_index
    left join paren_unique pu on pu.input_index = il.input_index
    left join token_unique tu on tu.input_index = il.input_index
    order by il.input_index;
$$;
