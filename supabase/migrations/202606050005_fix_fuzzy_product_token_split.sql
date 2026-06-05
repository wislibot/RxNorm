-- Fix fuzzy product token split matching
--
-- PROBLEM: Product name variants may contain concatenated tokens (e.g.,
-- "linagliptinmetformin" as a single token in rx_name_variants). When the
-- OCR input has separate tokens ("linagliptin" and "metformin"), neither
-- input stem matches the concatenated variant token, so product_token pass
-- fails.
--
-- FIX: Add a function that tries splitting a stem into two valid halves
-- (both existing in rx_product_variant_tokens.token_stem), then expand the
-- input stem set with those splits before coverage checking.

-- =========================================================================
-- 1. Function: rx_find_product_token_splits
-- Given a stem, try every split position from 3..len-3.
-- Return rows where BOTH halves exist in rx_product_variant_tokens.token_stem.
-- Requires input stem length >= 6.
-- =========================================================================
create or replace function public.rx_find_product_token_splits(input_stem text)
returns table(left_stem text, right_stem text)
language sql
stable
set search_path = public
as $$
    select
        left(input_stem, pos) as left_stem,
        substring(input_stem from pos + 1) as right_stem
    from generate_series(3, length(input_stem) - 3) as pos
    where length(input_stem) >= 6
      and left(input_stem, pos) in (
          select token_stem from public.rx_product_variant_tokens
      )
      and substring(input_stem from pos + 1) in (
          select token_stem from public.rx_product_variant_tokens
      )
$$;

-- =========================================================================
-- 2. Function: rx_match_medication_lines (with fuzzy product token split)
--
-- Passes:
--   1. product_exact     (0.95) — normalized text matches product name variant
--   2. product_token     (0.70) — all variant tokens covered by input (with fuzzy split expansion)
--   3. canonical_exact   (0.95) — unchanged
--   4. alias_exact       (0.90) — unchanged
--   5. paren_alias       (0.85) — unchanged
--   6. ingredient_token  (0.65) — unchanged
-- =========================================================================
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
    -- Pass 2: product token match (with fuzzy split expansion)
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

    -- NEW: find two-part splits for each input stem where both halves
    -- exist as token_stems in rx_product_variant_tokens
    product_token_split_stems as (
        select
            ptis.input_index,
            ptis.stem as original_stem,
            splits.left_stem,
            splits.right_stem
        from product_token_input_stems ptis
        cross join lateral public.rx_find_product_token_splits(ptis.stem)
            as splits(left_stem, right_stem)
    ),

    -- Expanded stem set: original stems + split halves.
    -- Replaces non-matching concatenated stems with their valid splits.
    product_token_input_stems_expanded as (
        -- original stems
        select input_index, stem, raw_token
        from product_token_input_stems
        union
        -- left halves of splits
        select ps.input_index, ps.left_stem as stem, ps.left_stem as raw_token
        from product_token_split_stems ps
        union
        -- right halves of splits
        select ps.input_index, ps.right_stem as stem, ps.right_stem as raw_token
        from product_token_split_stems ps
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

    -- Check coverage per variant using expanded stems:
    -- all variant tokens must be covered by input (original + splits)
    product_variant_coverage as (
        select
            ptis.input_index,
            pvt.nhi_code,
            pvt.variant_id
        from product_token_input_stems_expanded ptis
        join product_variant_tokens pvt
            on true  -- cross join: check every variant against every input
        group by ptis.input_index, pvt.nhi_code, pvt.variant_id
        having not exists (
            select 1
            from product_variant_tokens pvt2
            where pvt2.variant_id = pvt.variant_id
              and not exists (
                  select 1
                  from product_token_input_stems_expanded ptis2
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
