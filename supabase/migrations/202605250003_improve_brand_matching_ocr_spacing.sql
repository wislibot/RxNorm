-- Add OCR spacing normalization for brand matching robustness
-- Handles "Respi mat" -> "Respimat", "2. 5" -> "2.5" etc.
create or replace function public.rx_normalize_ocr_spacing(input_text text)
returns text
language plpgsql
immutable
as $$
declare
    result text;
    prev text;
begin
    result := lower(trim(regexp_replace(coalesce(input_text, ''), '\s+', ' ', 'g')));

    -- Normalize spaced decimals: "2. 5" -> "2.5", "2 .5" -> "2.5"
    result := regexp_replace(result, '(\d)\s*\.\s*(\d)', '\1.\2', 'g');

    -- Strip orphan trailing "number." fragments left by dosage-stripping
    result := trim(regexp_replace(result, ' \d+\.(\s|$)', ' ', 'g'));

    -- Merge split alpha tokens (both sides 2-5 chars, up to 3 passes)
    for i in 1..3 loop
        prev := result;
        result := regexp_replace(result, '\m([a-z]{2,5}) +([a-z]{2,5})\M', '\1\2', 'g');
        exit when result = prev;
    end loop;

    return result;
end;
$$;


-- Rebuild rx_match_brand_lines to use rx_normalize_ocr_spacing on both input and product names
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
    confidence numeric,
    product_name_zh text,
    product_name_en text
)
language sql
security invoker
set search_path = public
as $$
    with input_lines as (
        select
            source.ordinality::int - 1 as input_index,
            source.input_text,
            public.rx_normalize_ocr_spacing(
                public.rx_strip_dosage_tail(
                    public.rx_normalize_ocr_spacing(source.input_text)
                )
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
            on public.rx_normalize_ocr_spacing(
                public.rx_strip_dosage_tail(coalesce(product.name_en, ''))
               ) = input_lines.normalized_text
            or public.rx_normalize_ocr_spacing(
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
            min(nhi_code) as nhi_code,
            min(name_zh) as name_zh,
            min(name_en) as name_en
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
            min(nhi_code) as nhi_code,
            min(name_zh) as name_zh,
            min(name_en) as name_en
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
        end as confidence,
        case
            when product_unique.candidate_count = 1 then product_unique.name_zh
            when alias_unique.candidate_count = 1 then alias_unique.name_zh
            else null
        end as product_name_zh,
        case
            when product_unique.candidate_count = 1 then product_unique.name_en
            when alias_unique.candidate_count = 1 then alias_unique.name_en
            else null
        end as product_name_en
    from input_lines
    left join product_unique
        on product_unique.input_index = input_lines.input_index
    left join alias_unique
        on alias_unique.input_index = input_lines.input_index
    order by input_lines.input_index;
$$;

grant execute on function public.rx_match_brand_lines(text[]) to authenticated;
