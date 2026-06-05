-- Fix index alignment after merge in rx_match_medication_lines
--
-- When lines are merged (e.g., 3 split lines → 1 merged line), the RPC
-- returned fewer rows than the original input. The app expects one result
-- row per ORIGINAL line.
--
-- Fix:
-- 1. Track original line indices (original_lines CTE)
-- 2. Build a mapping from original indices to merged indices (orig_to_merged
--    CTE using prefix matching — each merged line starts with the text of
--    the first original line it consumed)
-- 3. All matching CTEs operate on merged lines only (merged_with_idx)
-- 4. Final SELECT returns one row per ORIGINAL line, inheriting match
--    results from the merged line it belongs to via LEFT JOIN

-- =========================================================================
-- Update rx_match_medication_lines to fix index alignment
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
    WITH merged_lines AS (
        SELECT public.rx_merge_medication_lines(medication_lines) AS lines
    ),

    -- Original lines: one row per ORIGINAL input line (preserves input_index)
    original_lines AS (
        SELECT
            src.ordinality - 1 AS input_index,
            src.input_text,
            public.rx_normalize_text(src.input_text) AS normalized_text,
            case
                when position('(' in coalesce(src.input_text, '')) > 0
                 and position(')' in coalesce(src.input_text, '')) > position('(' in coalesce(src.input_text, ''))
                    then public.rx_normalize_text(
                        substring(src.input_text from position('(' in src.input_text) + 1 for
                            position(')' in src.input_text) - position('(' in src.input_text) - 1))
                else null
            end as paren_normalized_text,
            public.rx_normalize_text(
                regexp_replace(src.input_text, '\\([^)]*\\)', '', 'g')
            ) as product_match_text
        FROM unnest(medication_lines) WITH ORDINALITY AS src(input_text, ordinality)
    ),

    -- Merged lines: one row per merged line with merged_index
    merged_with_idx AS (
        SELECT
            m.ordinality - 1 AS merged_index,
            m.input_text,
            public.rx_normalize_text(m.input_text) AS normalized_text,
            case
                when position('(' in coalesce(m.input_text, '')) > 0
                 and position(')' in coalesce(m.input_text, '')) > position('(' in coalesce(m.input_text, ''))
                    then public.rx_normalize_text(
                        substring(m.input_text from position('(' in m.input_text) + 1 for
                            position(')' in m.input_text) - position('(' in m.input_text) - 1))
                else null
            end as paren_normalized_text,
            public.rx_normalize_text(
                regexp_replace(m.input_text, '\\([^)]*\\)', '', 'g')
            ) as product_match_text
        FROM unnest((SELECT lines FROM merged_lines)) WITH ORDINALITY AS m(input_text, ordinality)
    ),

    -- Mapping: each original line → the merged line it belongs to.
    -- The merge function builds merged text by concatenating original lines
    -- with space separator, so each merged line starts with the text of the
    -- first original line it consumed. We use this to identify merge groups.
    orig_to_merged AS (
        WITH merged_starts AS (
            SELECT
                om.input_index AS orig_idx,
                mw.merged_index
            FROM (SELECT input_index, input_text FROM original_lines) om
            JOIN merged_with_idx mw ON mw.input_text LIKE om.input_text || '%'
        ),
        ranked AS (
            SELECT
                orig_idx,
                merged_index,
                row_number() OVER (PARTITION BY orig_idx ORDER BY merged_index) AS rn
            FROM merged_starts
        )
        SELECT orig_idx, merged_index
        FROM ranked
        WHERE rn = 1
    ),

    -- =========================================================================
    -- Pass 1: product exact match (on merged lines)
    -- =========================================================================
    product_exact_candidates as (
        select
            mw.merged_index,
            p.nhi_code as product_id,
            coalesce(p.name_en, p.name_zh) as product_display_name,
            pi.ingredient_id
        from merged_with_idx mw
        join public.rx_name_variants nv
            on nv.target_type = 'product'
           and nv.normalized_text = mw.product_match_text
        join public.rx_drug_products p
            on p.nhi_code = nv.target_id
        left join public.rx_product_ingredients pi
            on pi.nhi_code = p.nhi_code
        group by mw.merged_index, p.nhi_code, coalesce(p.name_en, p.name_zh), pi.ingredient_id
    ),
    product_exact_unique as (
        select
            merged_index,
            count(distinct product_id) as candidate_count,
            min(product_id) as product_id,
            min(product_display_name) as product_display_name,
            min(ingredient_id::text)::uuid as ingredient_id
        from product_exact_candidates
        group by merged_index
    ),

    -- =========================================================================
    -- Pass 2: product token match (on merged lines)
    -- =========================================================================
    product_token_input_stems as (
        select
            mw.merged_index,
            public.rx_strip_plural_stem(t.token) as stem,
            t.token as raw_token
        from merged_with_idx mw
        cross join lateral unnest(string_to_array(mw.normalized_text, ' ')) as t(token)
        where coalesce(mw.normalized_text, '') <> ''
          and t.token <> ''
          and length(t.token) >= 2
    ),

    product_token_split_stems as (
        select
            ptis.merged_index,
            ptis.stem as original_stem,
            splits.left_stem,
            splits.right_stem
        from product_token_input_stems ptis
        cross join lateral public.rx_find_product_token_splits(ptis.stem)
            as splits(left_stem, right_stem)
    ),

    product_token_input_stems_expanded as (
        select merged_index, stem, raw_token
        from product_token_input_stems
        union
        select ps.merged_index, ps.left_stem as stem, ps.left_stem as raw_token
        from product_token_split_stems ps
        union
        select ps.merged_index, ps.right_stem as stem, ps.right_stem as raw_token
        from product_token_split_stems ps
    ),

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

    product_variant_coverage as (
        select
            ptis.merged_index,
            pvt.nhi_code,
            pvt.variant_id
        from product_token_input_stems_expanded ptis
        join product_variant_tokens pvt
            on true
        group by ptis.merged_index, pvt.nhi_code, pvt.variant_id
        having not exists (
            select 1
            from product_variant_tokens pvt2
            where pvt2.variant_id = pvt.variant_id
              and not exists (
                  select 1
                  from product_token_input_stems_expanded ptis2
                  where ptis2.merged_index = ptis.merged_index
                    and (ptis2.stem = pvt2.token_stem or ptis2.raw_token = pvt2.raw_token)
              )
        )
    ),

    product_token_dedup as (
        select
            merged_index,
            nhi_code,
            count(distinct variant_id) as matched_variants
        from product_variant_coverage
        group by merged_index, nhi_code
    ),
    product_token_unique as (
        select
            ptd.merged_index,
            count(distinct ptd.nhi_code) as candidate_count,
            min(ptd.nhi_code) as product_id,
            min(coalesce(p.name_en, p.name_zh)) as product_display_name
        from product_token_dedup ptd
        join public.rx_drug_products p on p.nhi_code = ptd.nhi_code
        group by ptd.merged_index
    ),

    -- =========================================================================
    -- Pass 3: canonical exact (on merged lines)
    -- =========================================================================
    canonical_candidates as (
        select
            mw.merged_index,
            c.ingredient_id,
            c.canonical_name
        from merged_with_idx mw
        join public.rx_ingredient_concepts c
            on c.canonical_name_normalized = mw.normalized_text
    ),
    canonical_unique as (
        select
            merged_index,
            count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name) as canonical_name
        from canonical_candidates
        group by merged_index
    ),

    -- =========================================================================
    -- Pass 4: alias exact (on merged lines)
    -- =========================================================================
    alias_candidates as (
        select
            mw.merged_index,
            c.ingredient_id,
            c.canonical_name
        from merged_with_idx mw
        join public.rx_name_variants nv
            on nv.target_type = 'ingredient'
           and nv.normalized_text = mw.normalized_text
        join public.rx_ingredient_concepts c
            on c.ingredient_id::text = nv.target_id
    ),
    alias_unique as (
        select
            merged_index,
            count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name) as canonical_name
        from alias_candidates
        group by merged_index
    ),

    -- =========================================================================
    -- Pass 5: paren alias (on merged lines)
    -- =========================================================================
    paren_candidates as (
        select
            mw.merged_index,
            c.ingredient_id,
            c.canonical_name
        from merged_with_idx mw
        join public.rx_name_variants nv
            on nv.target_type = 'ingredient'
           and nv.normalized_text = mw.paren_normalized_text
        join public.rx_ingredient_concepts c
            on c.ingredient_id::text = nv.target_id
        where mw.paren_normalized_text is not null
          and length(mw.paren_normalized_text) >= 3

        union all

        select
            mw.merged_index,
            c.ingredient_id,
            c.canonical_name
        from merged_with_idx mw
        join public.rx_ingredient_concepts c
            on c.canonical_name_normalized = mw.paren_normalized_text
        where mw.paren_normalized_text is not null
          and length(mw.paren_normalized_text) >= 3
    ),
    paren_unique as (
        select
            merged_index,
            count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name) as canonical_name
        from paren_candidates
        group by merged_index
    ),

    -- =========================================================================
    -- Pass 6: ingredient token match (on merged lines)
    -- =========================================================================
    token_input_stems as (
        select
            mw.merged_index,
            public.rx_strip_plural_stem(t.token) as stem,
            t.token as raw_token
        from merged_with_idx mw
        cross join lateral unnest(string_to_array(mw.normalized_text, ' ')) as t(token)
        where coalesce(mw.normalized_text, '') <> ''
          and t.token <> ''
          and length(t.token) >= 2
    ),
    token_stem_matches as (
        select distinct
            tis.merged_index,
            rit.ingredient_id
        from token_input_stems tis
        join public.rx_ingredient_tokens rit
            on rit.token_stem = tis.stem
    ),
    token_candidate_sigs as (
        select
            sm.merged_index,
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
                  where tis.merged_index = sm.merged_index
                    and (tis.stem = tok2.token_stem or tis.raw_token = tok2.token)
              )
        )
        group by sm.merged_index, sm.ingredient_id, c.canonical_name
    ),
    token_candidates as (
        select
            merged_index,
            ingredient_id,
            canonical_name,
            token_signature
        from token_candidate_sigs
    ),
    token_unique as (
        select
            merged_index,
            count(distinct token_signature) as candidate_count,
            (array_agg(ingredient_id::text ORDER BY length(canonical_name), canonical_name))[1]::uuid as ingredient_id,
            (array_agg(canonical_name ORDER BY length(canonical_name), canonical_name))[1] as canonical_name
        from token_candidates
        group by merged_index
    ),

    -- =========================================================================
    -- Assemble match results per merged line
    -- =========================================================================
    merged_results AS (
        select
            mw.merged_index,
            mw.input_text,
            mw.normalized_text,
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
        from merged_with_idx mw
        left join product_exact_unique peu on peu.merged_index = mw.merged_index
        left join product_token_unique ptu on ptu.merged_index = mw.merged_index
        left join canonical_unique cu on cu.merged_index = mw.merged_index
        left join alias_unique au on au.merged_index = mw.merged_index
        left join paren_unique pu on pu.merged_index = mw.merged_index
        left join token_unique tu on tu.merged_index = mw.merged_index
    )

    -- =========================================================================
    -- Final: one row per ORIGINAL line, inheriting results from its merged line
    -- =========================================================================
    select
        ol.input_index,
        ol.input_text,
        ol.normalized_text,
        mr.match_status,
        mr.ingredient_id,
        mr.ingredient_ids,
        mr.ingredient_canonical_name,
        mr.match_method,
        mr.confidence,
        mr.product_id,
        mr.product_display_name
    from original_lines ol
    left join orig_to_merged otm on otm.orig_idx = ol.input_index
    left join merged_results mr on mr.merged_index = otm.merged_index
    order by ol.input_index;
$$;
