create extension if not exists pgcrypto;

create table if not exists public.rx_import_batches (
    import_batch_id uuid primary key default gen_random_uuid(),
    source_name text not null,
    source_version text,
    imported_at timestamptz not null default timezone('utc', now()),
    row_count integer not null default 0,
    notes text
);

create table if not exists public.raw_nhi_items (
    raw_nhi_item_id bigserial primary key,
    import_batch_id uuid not null references public.rx_import_batches(import_batch_id) on delete restrict,
    row_number integer,
    change_flag text,
    nhi_code text not null,
    name_en text,
    name_zh text,
    ingredient_text text,
    strength_value numeric,
    strength_unit text,
    combo_flag text,
    price_nhi numeric,
    effective_start date,
    effective_end date,
    vendor_name text,
    manufacturer_name text,
    dose_form text,
    drug_category text,
    category_group_name text,
    atc_code text,
    reimbursement_section text,
    tfda_link text,
    reimbursement_section_link text,
    source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.raw_tfda_permits_all (
    raw_tfda_permit_all_id bigserial primary key,
    import_batch_id uuid not null references public.rx_import_batches(import_batch_id) on delete restrict,
    row_number integer,
    tfda_permit_no text not null,
    cancel_status text,
    cancel_date date,
    cancel_reason text,
    expiry_date date,
    issue_date date,
    permit_type text,
    old_permit_no text,
    customs_doc_no text,
    product_name_zh text,
    product_name_en text,
    indications text,
    dosage_form text,
    packaging text,
    drug_class text,
    controlled_substance_level text,
    ingredient_text_tfda text,
    applicant_name text,
    applicant_address text,
    applicant_tax_id text,
    manufacturer_name text,
    manufacturer_site_address text,
    manufacturer_company_address text,
    manufacturer_country text,
    manufacturing_process text,
    change_date date,
    usage_dosage text,
    packaging_barcode text,
    source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.raw_tfda_permits_active (
    raw_tfda_permit_active_id bigserial primary key,
    import_batch_id uuid not null references public.rx_import_batches(import_batch_id) on delete restrict,
    row_number integer,
    tfda_permit_no text not null,
    cancel_status text,
    cancel_date date,
    cancel_reason text,
    expiry_date date,
    issue_date date,
    permit_type text,
    old_permit_no text,
    customs_doc_no text,
    product_name_zh text,
    product_name_en text,
    indications text,
    dosage_form text,
    packaging text,
    drug_class text,
    controlled_substance_level text,
    ingredient_text_tfda text,
    applicant_name text,
    applicant_address text,
    applicant_tax_id text,
    manufacturer_name text,
    manufacturer_site_address text,
    manufacturer_company_address text,
    manufacturer_country text,
    manufacturing_process text,
    change_date date,
    usage_dosage text,
    packaging_barcode text,
    source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.raw_atc_ddd (
    raw_atc_ddd_id bigserial primary key,
    import_batch_id uuid not null references public.rx_import_batches(import_batch_id) on delete restrict,
    row_number integer,
    snapshot_date date,
    record_type text,
    atc_code text not null,
    atc_name text,
    ddd numeric,
    uom text,
    adm_r text,
    note text,
    brand_name text,
    dosage_form text,
    ingredients text,
    ddd_comb text,
    source_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.raw_nhi_component_map (
    raw_nhi_component_map_id bigserial primary key,
    import_batch_id uuid not null references public.rx_import_batches(import_batch_id) on delete restrict,
    row_number integer,
    component_code text,
    reimbursed_component_code text,
    reimbursed_component_name text,
    source_payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_rx_import_batches_source_name
    on public.rx_import_batches (source_name, imported_at desc);

create index if not exists idx_raw_nhi_items_import_batch_id
    on public.raw_nhi_items (import_batch_id);

create index if not exists idx_raw_nhi_items_nhi_code
    on public.raw_nhi_items (nhi_code);

create index if not exists idx_raw_nhi_items_atc_code
    on public.raw_nhi_items (atc_code);

create index if not exists idx_raw_tfda_permits_all_import_batch_id
    on public.raw_tfda_permits_all (import_batch_id);

create index if not exists idx_raw_tfda_permits_all_tfda_permit_no
    on public.raw_tfda_permits_all (tfda_permit_no);

create index if not exists idx_raw_tfda_permits_active_import_batch_id
    on public.raw_tfda_permits_active (import_batch_id);

create index if not exists idx_raw_tfda_permits_active_tfda_permit_no
    on public.raw_tfda_permits_active (tfda_permit_no);

create index if not exists idx_raw_atc_ddd_import_batch_id
    on public.raw_atc_ddd (import_batch_id);

create index if not exists idx_raw_atc_ddd_atc_code
    on public.raw_atc_ddd (atc_code);

create index if not exists idx_raw_nhi_component_map_import_batch_id
    on public.raw_nhi_component_map (import_batch_id);

create index if not exists idx_raw_nhi_component_map_component_code
    on public.raw_nhi_component_map (component_code);
