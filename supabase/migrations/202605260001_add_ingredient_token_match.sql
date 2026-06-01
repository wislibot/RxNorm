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
                when coalesce(source.input_text, '') ~ '\([^()]*[A-Za-z][^()]*\)'
                    then public.rx_normalize_text(substring(source.input_text from '\(([^()]*)\)'))
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

        union all

        select
            input_lines.input_index,
            concepts.ingredient_id,
            concepts.canonical_name
        from input_lines
        join public.rx_ingredient_concepts as concepts
            on concepts.canonical_name_normalized = input_lines.paren_normalized_text
        where input_lines.paren_normalized_text is not null
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
         and il.normalized_text ~ ('\m' || c.canonical_name_normalized || '\M')
        where coalesce(il.normalized_text, '') <> ''
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
