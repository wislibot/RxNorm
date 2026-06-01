-- Reconcile rx_match_medication_lines: simplify token regex and restore = 1 guard.
--
-- PROBLEM 1: The previous migration (202605260001) was hand-edited in the live DB
-- to loosen the token pass from candidate_count = 1 to candidate_count >= 1. This
-- is a safety regression: a combo drug line like "Linagliptin & Metformin" now
-- MATCHES one ingredient arbitrarily and SILENTLY HIDES the other. On a medication
-- app, a hidden ingredient means a missed interaction.
--
-- PROBLEM 2: The dosage-stripping regex branches (strip ' *...' and ' *MG *$'
-- from canonical names before word-boundary matching) cause false ambiguity. For
-- example, "Acarbose 50mg" matches ACARBOSE, ACARBOSE 50 MG, and ACARBOSE 100 MG
-- (all 3 stripped to "ACARBOSE"), giving candidate_count = 3 → unmatched. This
-- is a false negative — the plain ACARBOSE is the correct unique match.
--
-- FIX: Remove dosage-stripping branches entirely. The token pass now uses only:
-- 1. Exact word match: input ~ [[:<:]]canonical[[:>:]]
-- 2. Plural strip: input ~ [[:<:]]stripPlural(canonical)(S|ES)[[:>:]]
--
-- The = 1 guard is restored. Also adds drop-before-create for rx_match_brand_lines
-- in migration 202605250001 to resolve the "cannot change return type" push failure.

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
    token_candidates as (
        select
            il.input_index,
            c.ingredient_id,
            c.canonical_name
        from input_lines il
        join public.rx_ingredient_concepts c
          on char_length(c.canonical_name_normalized) >= 4
        where coalesce(il.normalized_text, '') <> ''
          and (
              il.normalized_text ~ ('[[:<:]]' || c.canonical_name_normalized || '[[:>:]]')
              or il.normalized_text ~ ('[[:<:]]' || regexp_replace(c.canonical_name_normalized, '(S|ES)$', '', 'g') || '(S|ES)[[:>:]]')
          )
    ),
    token_unique as (
        select
            input_index,
            count(distinct ingredient_id) as candidate_count,
            min(ingredient_id::text)::uuid as ingredient_id,
            min(canonical_name)            as canonical_name
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
-- These tests validate the ambiguity guard, precedence, and token improvements.
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
    -- =========================================================================
    -- TEST 1: COMBO GUARD (critical safety test)
    -- A line with two DIFFERENT ingredient tokens must return unmatched.
    -- If this fails, one ingredient is silently dropped — dangerous on a med app.
    -- =========================================================================
    select match_status, match_method, ingredient_id
    into v_status, v_method, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Linagliptin & Metformin 850mg']);

    test_name := 'combo_guard_two_ingredients';
    passed := (v_status = 'unmatched' and v_ingredient_id is null);
    detail := format('status=%s method=%s ingredient_id=%s', v_status, v_method, v_ingredient_id);
    return next;

    -- =========================================================================
    -- TEST 2: Plural token pass — 'Sennosides 12mg' plural-matches SENNOSIDE
    -- (the base canonical). No other SENNOSIDE variant matches via exact word or
    -- plural strip, so candidate_count = 1 → matched. This is correct: the user
    -- typed "Sennosides" and the DB has exactly one SENNOSIDE base canonical.
    -- =========================================================================
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Sennosides 12mg']);

    test_name := 'token_plural_unique_sennoside_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- =========================================================================
    -- TEST 3: Canonical exact takes precedence over token
    -- =========================================================================
    select match_status, match_method, confidence
    into v_status, v_method, v_confidence
    from public.rx_match_medication_lines(ARRAY['OMEPRAZOLE']);

    test_name := 'canonical_exact_precedence';
    passed := (v_status = 'matched' and v_method = 'canonical_exact' and v_confidence = 0.95);
    detail := format('status=%s method=%s confidence=%s', v_status, v_method, v_confidence);
    return next;

    -- =========================================================================
    -- TEST 4: Paren precedence over token (bag 1 regression check)
    -- '60puff/bot(tiotropium)' should match via paren, not token.
    -- =========================================================================
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['60puff/bot(tiotropium)']);

    test_name := 'paren_precedence_over_token';
    passed := (v_status = 'matched' and v_method = 'paren_alias_exact' and v_confidence = 0.85);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- =========================================================================
    -- TEST 5: Token pass for unique ingredient — 'Omeprazole 20mg' tokenizes to
    -- OMEPRAZOLE. Only the plain OMEPRAZOLE canonical matches via exact word
    -- (dosage variants like OMEPRAZOLE 20 MG don't match), so candidate_count = 1.
    -- =========================================================================
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Omeprazole 20mg']);

    test_name := 'token_unique_omeprazole_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_confidence = 0.65);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- =========================================================================
    -- TEST 6: Plural matching — 'Sennosides 2mg' plural-matches SENNOSIDE
    -- =========================================================================
    select match_status, match_method, ingredient_canonical_name
    into v_status, v_method, v_canonical
    from public.rx_match_medication_lines(ARRAY['Sennosides 2mg']);

    test_name := 'token_plural_sennosides_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_canonical = 'SENNOSIDE');
    detail := format('status=%s method=%s canonical=%s', v_status, v_method, v_canonical);
    return next;

    -- =========================================================================
    -- TEST 7: Combo guard with plural/dosage variants
    -- Even with plural matching enabled, a combo line must not match.
    -- =========================================================================
    select match_status, ingredient_id
    into v_status, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Sennosides & Omeprazole 2mg']);

    test_name := 'combo_guard_two_ingredient_tokens';
    passed := (v_status = 'unmatched' and v_ingredient_id is null);
    detail := format('status=%s ingredient_id=%s', v_status, v_ingredient_id);
    return next;

    -- =========================================================================
    -- TEST 8: Token pass works for unique ingredient
    -- 'Acarbose 50mg' -> ACARBOSE has exactly 1 word-boundary match -> matched
    -- =========================================================================
    select match_status, match_method, confidence, ingredient_canonical_name
    into v_status, v_method, v_confidence, v_canonical
    from public.rx_match_medication_lines(ARRAY['Acarbose 50mg']);

    test_name := 'token_unique_acarbose_matches';
    passed := (v_status = 'matched' and v_method = 'ingredient_token' and v_confidence = 0.65);
    detail := format('status=%s method=%s confidence=%s canonical=%s', v_status, v_method, v_confidence, v_canonical);
    return next;

    -- =========================================================================
    -- TEST 9: Unmatched for unknown ingredient
    -- =========================================================================
    select match_status, ingredient_id
    into v_status, v_ingredient_id
    from public.rx_match_medication_lines(ARRAY['Xyzalol 999mg']);

    test_name := 'unmatched_unknown_ingredient';
    passed := (v_status = 'unmatched' and v_ingredient_id is null);
    detail := format('status=%s ingredient_id=%s', v_status, v_ingredient_id);
    return next;

    -- =========================================================================
    -- TEST 10: Empty input returns empty result
    -- =========================================================================
    test_name := 'empty_input';
    passed := (select count(*) from public.rx_match_medication_lines(ARRAY[]::text[])) = 0;
    detail := 'empty array returns no rows';
    return next;
end;
$$;
