-- Fix token match logic in rx_match_medication_lines (final)
--
-- PROBLEM 1: Logic direction inverted — checks "all input tokens in ingredient"
-- instead of "all ingredient tokens in input". Dosage tokens like 12MG must
-- exist in the ingredient, which fails.
--
-- PROBLEM 2: Multiple candidates with identical token sets (e.g. SENNOSIDE,
-- SENNOSIDE A, SENNOSIDE B all matching via token "SENNOSIDE") give
-- candidate_count > 1, causing combo guard false rejection.
--
-- PROBLEM 3: Cross join scans all ~13k ingredients per input line.
-- Fix: reverse lookup — tokenize input, find ingredients via indexed
-- rx_ingredient_tokens lookup, then verify coverage.
--
-- FIX: Rewrite token_candidates CTE:
-- 1. Tokenize input stems via rx_strip_plural_stem
-- 2. Find candidate ingredient_ids by indexed stem lookup
-- 3. Verify ALL ingredient tokens are covered by input (ingredient ⊂ input)
-- 4. Prefer base ingredient (shortest canonical_name) when duplicates exist

drop function if exists public.rx_match_medication_lines(text[]);

create or replace function public.rx_match_medication_lines(medication_lines text[])
returns table (
    input_index int,
    input_text text,
    normalized_text text,
    match_status text,
    ingredient_id uuid,
    ingredient_canonical_name text,
    match_method text,
    confidence numeric
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
            end as paren_normalized_text
        from unnest(coalesce(medication_lines, '{}'::text[])) with ordinality as source(input_text, ordinality)
    ),
    -- Pass 1: canonical exact
    canonical_candidates as (
        select
            input_lines.input_index,
            concepts.ingredient_id,
            concepts.canonical_name
        from input_lines
        join public.rx_ingredient_concepts as concepts
            on concepts.canonical_name_normalized = input_lines.normalized_text
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
    -- Pass 2: alias exact
    alias_candidates as (
        select
            input_lines.input_index,
            concepts.ingredient_id,
            concepts.canonical_name
        from input_lines
        join public.rx_name_variants as variants
            on variants.target_type = 'ingredient'
           and variants.normalized_text = input_lines.normalized_text
        join public.rx_ingredient_concepts as concepts
            on concepts.ingredient_id::text = variants.target_id
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
    -- Pass 3: paren alias
    paren_candidates as (
        select
            input_lines.input_index,
            concepts.ingredient_id,
            concepts.canonical_name
        from input_lines
        join public.rx_name_variants as variants
            on variants.target_type = 'ingredient'
           and variants.normalized_text = input_lines.paren_normalized_text
        join public.rx_ingredient_concepts as concepts
            on concepts.ingredient_id::text = variants.target_id
        where input_lines.paren_normalized_text is not null
          and length(input_lines.paren_normalized_text) >= 3

        union all

        select
            input_lines.input_index,
            concepts.ingredient_id,
            concepts.canonical_name
        from input_lines
        join public.rx_ingredient_concepts as concepts
            on concepts.canonical_name_normalized = input_lines.paren_normalized_text
        where input_lines.paren_normalized_text is not null
          and length(input_lines.paren_normalized_text) >= 3
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
    -- Pass 4: token match (indexed reverse lookup)
    -- PROBLEM 3 fix: no cross join. Tokenize input, find ingredients via
    -- indexed rx_ingredient_tokens lookup, then verify coverage.
    -- PROBLEM 1 fix: verify ALL ingredient tokens are covered by input
    -- (ingredient tokens ⊂ input tokens). Extra input tokens are fine.
    token_input_stems as (
        select
            il.input_index,
            public.rx_strip_plural_stem(input_token.token) as stem,
            input_token.token as raw_token
        from input_lines il
        cross join lateral unnest(string_to_array(il.normalized_text, ' ')) as input_token(token)
        where coalesce(il.normalized_text, '') <> ''
          and input_token.token <> ''
          and length(input_token.token) >= 2
    ),
    -- Find candidate ingredients by indexed stem match against input tokens
    token_stem_matches as (
        select distinct
            tis.input_index,
            rit.ingredient_id
        from token_input_stems tis
        join public.rx_ingredient_tokens rit
            on rit.token_stem = tis.stem
    ),
    -- Verify ALL ingredient tokens are covered by the input (subset check)
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
    -- PROBLEM 2 fix: count distinct token_signatures, not ingredient_ids.
    -- Ingredients sharing the same token set (e.g. SENNOSIDE / SENNOSIDE A / SENNOSIDE B)
    -- produce one signature → candidate_count=1 → matched to base ingredient.
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
        input_lines.input_index,
        input_lines.input_text,
        input_lines.normalized_text,
        case
            when canonical_unique.candidate_count = 1 then 'matched'
            when alias_unique.candidate_count = 1 then 'matched'
            when paren_unique.candidate_count = 1 then 'matched'
            when token_unique.candidate_count = 1 then 'matched'
            else 'unmatched'
        end as match_status,
        case
            when canonical_unique.candidate_count = 1 then canonical_unique.ingredient_id
            when alias_unique.candidate_count = 1 then alias_unique.ingredient_id
            when paren_unique.candidate_count = 1 then paren_unique.ingredient_id
            when token_unique.candidate_count = 1 then token_unique.ingredient_id
            else null
        end as ingredient_id,
        case
            when canonical_unique.candidate_count = 1 then canonical_unique.canonical_name
            when alias_unique.candidate_count = 1 then alias_unique.canonical_name
            when paren_unique.candidate_count = 1 then paren_unique.canonical_name
            when token_unique.candidate_count = 1 then token_unique.canonical_name
            else null
        end as ingredient_canonical_name,
        case
            when canonical_unique.candidate_count = 1 then 'canonical_exact'
            when alias_unique.candidate_count = 1 then 'alias_exact'
            when paren_unique.candidate_count = 1 then 'paren_alias_exact'
            when token_unique.candidate_count = 1 then 'ingredient_token'
            else null
        end as match_method,
        case
            when canonical_unique.candidate_count = 1 then 0.95
            when alias_unique.candidate_count = 1 then 0.90
            when paren_unique.candidate_count = 1 then 0.85
            when token_unique.candidate_count = 1 then 0.65
            else null
        end as confidence
    from input_lines
    left join canonical_unique
        on canonical_unique.input_index = input_lines.input_index
    left join alias_unique
        on alias_unique.input_index = input_lines.input_index
    left join paren_unique
        on paren_unique.input_index = input_lines.input_index
    left join token_unique
        on token_unique.input_index = input_lines.input_index
    order by input_lines.input_index;
$$;


-- =============================================================================
-- TESTS: rx_match_medication_lines
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
    v_canonical text;
begin
    -- TEST 1: COMBO GUARD (critical safety)
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
    select match_status, match_method, confidence
    into v_status, v_method, v_confidence
    from public.rx_match_medication_lines(ARRAY['OMEPRAZOLE']);

    test_name := 'canonical_exact_precedence';
    passed := (v_status = 'matched' and v_method = 'canonical_exact' and v_confidence = 0.95);
    detail := format('status=%s method=%s confidence=%s', v_status, v_method, v_confidence);
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

    -- TEST 7: Combo guard with plural/dosage variants
    select match_status, ingredient_id
    into v_status, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Sennosides & Omeprazole 2mg']);

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
end;
$$;
