from pathlib import Path


RAW_MIGRATION = Path("supabase/migrations/202605130001_raw_schema.sql")
CURATED_MIGRATION = Path("supabase/migrations/202605130002_curated_schema.sql")
DDI_MIGRATION = Path("supabase/migrations/202605210003_add_ddi_curated_tables.sql")


def test_raw_migration_contains_required_tables() -> None:
    sql = RAW_MIGRATION.read_text(encoding="utf-8").lower()

    assert "create table if not exists public.rx_import_batches" in sql
    assert "create table if not exists public.raw_nhi_items" in sql
    assert "create table if not exists public.raw_tfda_permits_all" in sql
    assert "create table if not exists public.raw_tfda_permits_active" in sql
    assert "create table if not exists public.raw_atc_ddd" in sql
    assert "create table if not exists public.raw_nhi_component_map" in sql


def test_raw_migration_contains_batch_indexes() -> None:
    sql = RAW_MIGRATION.read_text(encoding="utf-8").lower()

    assert "references public.rx_import_batches" in sql
    assert "create index if not exists idx_raw_nhi_items_import_batch_id" in sql
    assert "create index if not exists idx_raw_tfda_permits_all_import_batch_id" in sql


def test_curated_migration_contains_view_and_tables() -> None:
    sql = CURATED_MIGRATION.read_text(encoding="utf-8").lower()

    assert "create table if not exists public.rx_drug_products" in sql
    assert "create table if not exists public.rx_ingredient_concepts" in sql
    assert "create table if not exists public.rx_product_ingredients" in sql
    assert "create table if not exists public.rx_name_variants" in sql
    assert "create table if not exists public.rx_tfda_permits" in sql
    assert "create table if not exists public.rx_nhi_tfda_map" in sql
    assert "create table if not exists public.rx_atc_reference_latest" in sql
    assert "create table if not exists public.rx_qc_all1_code_set" in sql
    assert "create table if not exists public.rx_review_queue" in sql
    assert "create or replace view public.rx_product_enriched_v" in sql


def test_curated_migration_contains_helper_function_and_indexes() -> None:
    sql = CURATED_MIGRATION.read_text(encoding="utf-8").lower()

    assert "create or replace function public.rx_normalize_text" in sql
    assert "create index if not exists idx_rx_drug_products_name_zh" in sql
    assert "create index if not exists idx_rx_name_variants_normalized_text" in sql
    assert "create index if not exists idx_rx_product_ingredients_ingredient_id" in sql
    assert "create index if not exists idx_rx_drug_products_atc_code" in sql


def test_ddi_migration_contains_curated_tables() -> None:
    sql = DDI_MIGRATION.read_text(encoding="utf-8").lower()

    assert "create table if not exists public.rx_ddi_severity_templates" in sql
    assert "create table if not exists public.rx_ddi_name_map" in sql
    assert "create table if not exists public.rx_ddi_pairs" in sql
    assert "patient_title_en text not null" in sql
    assert "patient_title_zh text" in sql
    assert "patient_message_en text not null" in sql
    assert "patient_message_zh text" in sql
    assert "staff_title_en text not null" in sql
    assert "staff_title_zh text" in sql
    assert "staff_message_en text not null" in sql
    assert "staff_message_zh text" in sql
    assert "recommended_action text not null" in sql
    assert "disclaimer text not null" in sql
    assert "updated_at timestamptz not null default timezone('utc', now())" in sql


def test_ddi_migration_contains_seeds_constraints_and_indexes() -> None:
    sql = DDI_MIGRATION.read_text(encoding="utf-8").lower()

    assert "insert into public.rx_ddi_severity_templates" in sql
    assert "'major'" in sql
    assert "'moderate'" in sql
    assert "'minor'" in sql
    assert "recommended_action = excluded.recommended_action" in sql
    assert "disclaimer = excluded.disclaimer" in sql
    assert "ingredient_id uuid references public.rx_ingredient_concepts(ingredient_id) on delete set null" in sql
    assert "updated_at timestamptz not null default now()" in sql
    assert "severity text not null references public.rx_ddi_severity_templates(severity) on delete restrict" in sql
    assert "source text not null default 'ddinter'" in sql
    assert "constraint uq_rx_ddi_pairs unique (ingredient_a_id, ingredient_b_id, source)" in sql
    assert "constraint ck_rx_ddi_pairs_order check (ingredient_a_id::text < ingredient_b_id::text)" in sql
    assert "check for active ingredients, consider alternatives, and monitor closely if coadministration cannot be avoided." in sql
    assert "this information supports, but does not replace, clinical judgment and patient-specific review." in sql
    assert "create index if not exists idx_rx_ddi_name_map_ingredient_id" in sql
    assert "create index if not exists idx_rx_ddi_pairs_ingredient_a_id" in sql
    assert "create index if not exists idx_rx_ddi_pairs_ingredient_b_id" in sql
    assert "create index if not exists idx_rx_ddi_pairs_severity" in sql
