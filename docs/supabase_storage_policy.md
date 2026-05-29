# Supabase Storage Policy

## Current Live Snapshot

Largest user tables from the 2026-05-19 inspection:

- `public.raw_nhi_items`: `309 MB`
- `public.raw_all1_price_history`: `246 MB`
- `public.raw_tfda_permits_all`: `134 MB`
- `public.rx_tfda_permits`: `59 MB`
- `public.raw_tfda_permits_active`: `49 MB`
- `public.rx_name_variants`: `47 MB`
- `public.rx_product_ingredients`: `37 MB`
- `public.rx_drug_products`: `34 MB`

## Policy

- Raw tables are **not retained** in Supabase.
- Supabase keeps curated tables plus curated-tier support tables such as `rx_qc_all1_code_set` and the DDI tables (`rx_ddi_severity_templates`, `rx_ddi_name_map`, `rx_ddi_pairs`).
- Reproducibility is preserved through exported raw snapshots in `outputs/exports/raw_drop_all/` and the source files in `Datasets/`.
- DDInter source files remain external to Supabase and stay in the workspace datasets area rather than being copied into database raw tables or storage buckets.
- `rx_import_batches` may remain as lightweight import metadata, but it is not a raw data store.

## Restore / Rebuild Path

The reproducible path is:

`exported raw snapshots or source files -> temporary raw restore/import -> curated rebuild`

Source files already live in:

- `Datasets/A21030000I-E41001-001.csv`
- `Datasets/A21030000I-E41002-002.csv`
- `Datasets/36_2.csv`
- `Datasets/37_2.csv`
- `Datasets/ATC_DDD_fabkury_merged.csv`
- `Datasets/all1_11505_1.TXT`
- `Datasets/all1_11505_2.TXT`

If a temporary raw restore is needed, recreate the raw tables, import from source files, then rebuild curated:

```bash
python -m etl.raw_import --database-url "$env:DATABASE_URL"
```

Rebuild curated tables after raw import:

```bash
python -m etl.rebuild_curated --database-url "$env:DATABASE_URL"
```

Regenerate QC after rebuild:

```bash
python -m etl.report_qc --database-url "$env:DATABASE_URL" --output-dir outputs/qc-supabase
```

QC overlap metrics use:

- `rx_qc_all1_code_set`
  - curated-tier support table containing distinct `nhi_code` values only
  - safe to keep in Supabase after raw table removal

## Operator Checklist

1. Export every `raw_*` table to `outputs/exports/raw_drop_all/`.
2. Verify every export.
   - Check row count matches the live table.
   - Check a few known IDs/codes.
3. Capture schema metadata.
   - Keep `raw_schema_columns.json` and `raw_schema_columns.csv`.
4. Populate and verify `rx_qc_all1_code_set`.
   - Check distinct-code count.
   - Check `nulls = 0` and `blanks = 0`.
   - Check the locked `all1-only` codes still exist.
5. Confirm QC runs without any `raw_*` table reads.
6. Drop all verified `raw_*` tables.
7. Run maintenance.

Recommended SQL after verified exports and QC proof:

```sql
drop table if exists public.raw_all1_code_set;
drop table if exists public.raw_atc_ddd;
drop table if exists public.raw_tfda_permits_active;
drop table if exists public.raw_tfda_permits_all;
drop table if exists public.raw_nhi_component_map;
drop table if exists public.raw_nhi_items;
vacuum analyze public.rx_drug_products;
vacuum analyze public.rx_review_queue;
vacuum analyze public.rx_qc_all1_code_set;
```

## Notes

- The raw snapshot manifest and schema snapshot live under `outputs/exports/raw_drop_all/`.
- `rx_qc_all1_code_set` is the only retained in-DB `all1` artifact for QC after raw-table removal.
