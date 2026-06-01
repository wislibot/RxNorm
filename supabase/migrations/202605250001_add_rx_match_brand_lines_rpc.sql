-- Extend RLS to allow authenticated users to read product name variants
-- (brand matching needs product aliases, not just ingredient aliases)
drop policy if exists rx_name_variants_select_authenticated_v2 on public.rx_name_variants;
create policy rx_name_variants_select_authenticated_v2
    on public.rx_name_variants
    for select
    to authenticated
    using (target_type in ('ingredient', 'product'));

-- Ensure authenticated can read rx_product_enriched_v
grant select on public.rx_product_enriched_v to authenticated;

create or replace function public.rx_strip_dosage_tail(input_text text)
returns text
language sql
immutable
as $$
    select
        regexp_replace(
            regexp_replace(
                coalesce(input_text, ''),
                '[,，]?\s*總量\s*\d+\s*[\u4E00-\u9FFF]{1,2}.*$',
                '',
                'i'
            ),
            '\m\d+(\.\d+)?\s*(mcg|mg|g|ml|iu|%)\M.*$',
            '',
            'i'
        );
$$;

-- Drop first: create or replace cannot change return type, and later migrations
-- (202605250002, 202605250003) extend this to 11 columns. Without the drop,
-- supabase db push fails with "cannot change return type of existing function".
drop function if exists public.rx_match_brand_lines(text[]);

create or replace function public.rx_match_brand_lines(brand_lines text[])
returns table (
    input_index int,
    input_text text,
    normalized_text text,
    match_status text,
    product_id text,
    product_display_name text,
    nhi_code text,
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
            public.rx_normalize_text(
                public.rx_strip_dosage_tail(source.input_text)
            ) as normalized_text
        from unnest(coalesce(brand_lines, '{}'::text[])) with ordinality as source(input_text, ordinality)
    ),
    product_candidates as (
        select
            input_lines.input_index,
            product.nhi_code as product_id,
            product.name_en,
            product.name_zh,
            coalesce(product.name_en, product.name_zh) as display_name,
            product.nhi_code
        from input_lines
        join public.rx_product_enriched_v as product
            on public.rx_normalize_text(
                public.rx_strip_dosage_tail(coalesce(product.name_en, ''))
               ) = input_lines.normalized_text
            or public.rx_normalize_text(
                public.rx_strip_dosage_tail(coalesce(product.name_zh, ''))
               ) = input_lines.normalized_text
        where length(input_lines.normalized_text) >= 4
    ),
    product_unique as (
        select
            input_index,
            count(distinct coalesce(name_en, '') || '|' || coalesce(name_zh, '')) as candidate_count,
            min(product_id) as product_id,
            min(display_name) as display_name,
            min(nhi_code) as nhi_code
        from product_candidates
        group by input_index
    ),
    alias_candidates as (
        select
            input_lines.input_index,
            product.nhi_code as product_id,
            product.name_en,
            product.name_zh,
            coalesce(product.name_en, product.name_zh) as display_name,
            product.nhi_code
        from input_lines
        join public.rx_name_variants as variants
            on variants.target_type = 'product'
           and variants.normalized_text = input_lines.normalized_text
        join public.rx_product_enriched_v as product
            on product.nhi_code = variants.target_id
        where length(input_lines.normalized_text) >= 4
    ),
    alias_unique as (
        select
            input_index,
            count(distinct coalesce(name_en, '') || '|' || coalesce(name_zh, '')) as candidate_count,
            min(product_id) as product_id,
            min(display_name) as display_name,
            min(nhi_code) as nhi_code
        from alias_candidates
        group by input_index
    )
    select
        input_lines.input_index,
        input_lines.input_text,
        input_lines.normalized_text,
        case
            when product_unique.candidate_count = 1 then 'matched'
            when alias_unique.candidate_count = 1 then 'matched'
            else 'unmatched'
        end as match_status,
        case
            when product_unique.candidate_count = 1 then product_unique.product_id
            when alias_unique.candidate_count = 1 then alias_unique.product_id
            else null
        end as product_id,
        case
            when product_unique.candidate_count = 1 then product_unique.display_name
            when alias_unique.candidate_count = 1 then alias_unique.display_name
            else null
        end as product_display_name,
        case
            when product_unique.candidate_count = 1 then product_unique.nhi_code
            when alias_unique.candidate_count = 1 then alias_unique.nhi_code
            else null
        end as nhi_code,
        case
            when product_unique.candidate_count = 1 then 'product_exact'
            when alias_unique.candidate_count = 1 then 'alias_exact'
            else null
        end as match_method,
        case
            when product_unique.candidate_count = 1 then 0.95
            when alias_unique.candidate_count = 1 then 0.90
            else null
        end as confidence
    from input_lines
    left join product_unique
        on product_unique.input_index = input_lines.input_index
    left join alias_unique
        on alias_unique.input_index = input_lines.input_index
    order by input_lines.input_index;
$$;

grant execute on function public.rx_match_brand_lines(text[]) to authenticated;
