create extension if not exists pgcrypto;

create or replace function public.rx_normalize_text(input_text text)
returns text
language sql
immutable
as $$
    select trim(
        regexp_replace(
            upper(regexp_replace(coalesce(input_text, ''), '[[:punct:]]+', ' ', 'g')),
            '\s+',
            ' ',
            'g'
        )
    );
$$;

create table if not exists public.rx_drug_products (
    nhi_code text primary key,
    name_zh text,
    name_en text,
    ingredient_text_nhi text,
    dose_form text,
    strength_value numeric,
    strength_unit text,
    is_combo boolean,
    atc_code text,
    tfda_link text,
    price_nhi numeric,
    effective_start date,
    effective_end date,
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rx_ingredient_concepts (
    ingredient_id uuid primary key default gen_random_uuid(),
    canonical_name text not null,
    canonical_name_normalized text generated always as (public.rx_normalize_text(canonical_name)) stored,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint uq_rx_ingredient_concepts_canonical_name_normalized unique (canonical_name_normalized)
);

create table if not exists public.rx_product_ingredients (
    nhi_code text not null references public.rx_drug_products(nhi_code) on delete cascade,
    ingredient_id uuid not null references public.rx_ingredient_concepts(ingredient_id) on delete restrict,
    role text,
    strength_value numeric,
    strength_unit text,
    source text not null,
    primary key (nhi_code, ingredient_id, source)
);

create table if not exists public.rx_name_variants (
    variant_id uuid primary key default gen_random_uuid(),
    target_type text not null,
    target_id text not null,
    variant_text text not null,
    normalized_text text not null,
    language text,
    variant_type text,
    source text,
    created_at timestamptz not null default timezone('utc', now()),
    constraint ck_rx_name_variants_target_type check (target_type in ('ingredient', 'product'))
);

create table if not exists public.rx_tfda_permits (
    tfda_permit_no text primary key,
    is_cancelled boolean,
    cancel_date date,
    expiry_date date,
    issue_date date,
    controlled_substance_level text,
    product_name text,
    dosage_form text,
    packaging text,
    ingredient_text_tfda text,
    applicant_name text,
    applicant_address text,
    applicant_tax_id text,
    manufacturer_name text,
    manufacturer_address text,
    manufacturer_country text,
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.rx_nhi_tfda_map (
    nhi_code text not null references public.rx_drug_products(nhi_code) on delete cascade,
    tfda_permit_no text not null references public.rx_tfda_permits(tfda_permit_no) on delete cascade,
    link_source text not null,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (nhi_code, tfda_permit_no)
);

create table if not exists public.rx_atc_reference_latest (
    atc_code text primary key,
    atc_name text,
    ddd numeric,
    uom text,
    adm_r text,
    note text,
    snapshot_date date
);

create table if not exists public.rx_qc_all1_code_set (
    nhi_code text primary key
);

create table if not exists public.rx_review_queue (
    review_id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default timezone('utc', now()),
    source text not null,
    nhi_code text references public.rx_drug_products(nhi_code) on delete set null,
    tfda_permit_no text references public.rx_tfda_permits(tfda_permit_no) on delete set null,
    input_text text,
    ocr_text text,
    candidate_ingredient_ids uuid[],
    confidence numeric,
    status text not null default 'pending',
    review_notes text,
    constraint ck_rx_review_queue_status check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists idx_rx_drug_products_name_zh
    on public.rx_drug_products (name_zh);

create index if not exists idx_rx_drug_products_name_en
    on public.rx_drug_products (name_en);

create index if not exists idx_rx_drug_products_atc_code
    on public.rx_drug_products (atc_code);

create index if not exists idx_rx_name_variants_normalized_text
    on public.rx_name_variants (normalized_text);

create index if not exists idx_rx_product_ingredients_ingredient_id
    on public.rx_product_ingredients (ingredient_id);

create index if not exists idx_rx_tfda_permits_tfda_permit_no
    on public.rx_tfda_permits (tfda_permit_no);

create index if not exists idx_rx_nhi_tfda_map_tfda_permit_no
    on public.rx_nhi_tfda_map (tfda_permit_no);

create index if not exists idx_rx_review_queue_source_status
    on public.rx_review_queue (source, status, created_at desc);

create or replace view public.rx_product_enriched_v as
with ingredient_rollup as (
    select
        rpi.nhi_code,
        jsonb_agg(
            jsonb_build_object(
                'ingredient_id', ric.ingredient_id,
                'canonical_name', ric.canonical_name,
                'role', rpi.role,
                'strength_value', rpi.strength_value,
                'strength_unit', rpi.strength_unit,
                'source', rpi.source
            )
            order by ric.canonical_name, rpi.source
        ) as ingredients,
        array_agg(distinct ric.canonical_name order by ric.canonical_name) as ingredient_names
    from public.rx_product_ingredients as rpi
    join public.rx_ingredient_concepts as ric
        on ric.ingredient_id = rpi.ingredient_id
    group by rpi.nhi_code
),
tfda_rollup as (
    select
        map.nhi_code,
        jsonb_agg(
            jsonb_build_object(
                'tfda_permit_no', permit.tfda_permit_no,
                'product_name', permit.product_name,
                'dosage_form', permit.dosage_form,
                'ingredient_text_tfda', permit.ingredient_text_tfda,
                'is_cancelled', permit.is_cancelled,
                'link_source', map.link_source
            )
            order by permit.tfda_permit_no
        ) as tfda_permits
    from public.rx_nhi_tfda_map as map
    join public.rx_tfda_permits as permit
        on permit.tfda_permit_no = map.tfda_permit_no
    group by map.nhi_code
)
select
    product.nhi_code,
    product.name_zh,
    product.name_en,
    product.ingredient_text_nhi,
    product.dose_form,
    product.strength_value,
    product.strength_unit,
    product.is_combo,
    product.atc_code,
    product.tfda_link,
    product.price_nhi,
    product.effective_start,
    product.effective_end,
    product.updated_at,
    ingredient_rollup.ingredients,
    ingredient_rollup.ingredient_names,
    tfda_rollup.tfda_permits,
    atc.atc_name,
    atc.ddd,
    atc.uom,
    atc.adm_r,
    atc.note,
    atc.snapshot_date
from public.rx_drug_products as product
left join ingredient_rollup
    on ingredient_rollup.nhi_code = product.nhi_code
left join tfda_rollup
    on tfda_rollup.nhi_code = product.nhi_code
left join public.rx_atc_reference_latest as atc
    on atc.atc_code = product.atc_code;
