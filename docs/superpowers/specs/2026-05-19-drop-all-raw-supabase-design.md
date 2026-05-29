# Drop All Raw Supabase Design

## Goal

Remove every `raw_*` table from the live Supabase database while keeping reproducibility through exported raw snapshots and keeping QC functional with a curated-tier `all1` code-set table.

## Scope

- Export and verify all remaining raw tables.
- Add a curated/QC table: `rx_qc_all1_code_set`.
- Switch QC code, tests, and fresh-install schema to the curated/QC table.
- Prove QC runs without reading any `raw_*` table.
- Drop all `raw_*` tables only after export + verification + QC proof.

## Non-Goals

- No broader mismatch-normalization changes.
- No reintroduction of in-DB raw retention after the drop.

## Live Safety Gates

1. Export artifact exists for every raw table.
2. Export rowcount matches the live DB rowcount for every raw table.
3. Spot-check values exist in each export.
4. QC code/tests/docs are updated and pass locally.
5. Live QC succeeds with no dependency on `raw_*` tables.

## Design

### Exports

Export these tables to compressed CSV snapshots plus a manifest and schema snapshot:

- `raw_nhi_items`
- `raw_tfda_permits_active`
- `raw_tfda_permits_all`
- `raw_atc_ddd`
- `raw_all1_code_set`

Artifacts:

- `outputs/exports/*.csv.gz`
- `outputs/exports/raw_export_manifest.json`
- `outputs/exports/raw_schema.sql` or per-table column snapshots

### QC Table Migration

Create and populate:

```sql
CREATE TABLE IF NOT EXISTS public.rx_qc_all1_code_set (
  nhi_code text PRIMARY KEY
);
```

Populate from `raw_all1_code_set`, then switch repo code to read `rx_qc_all1_code_set`.

### Fresh-Install Schema

Fresh installs should create `rx_qc_all1_code_set` and should not create `raw_all1_code_set` by default.

### Final Drop

After export verification and QC proof:

- drop `raw_all1_code_set`
- drop `raw_atc_ddd`
- drop `raw_tfda_permits_active`
- drop `raw_tfda_permits_all`
- drop `raw_nhi_items`
- run maintenance

## Operator Notes

- Supabase is no longer the durable store for raw layers.
- Restore is done from exported raw snapshots or source files.
- QC keeps only the curated-tier `rx_qc_all1_code_set` in DB.
