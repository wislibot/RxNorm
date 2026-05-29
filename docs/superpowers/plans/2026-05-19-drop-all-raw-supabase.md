# Drop All Raw Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all live `raw_*` Supabase tables, preserve reproducibility through verified exports, and keep QC working through `rx_qc_all1_code_set`.

**Architecture:** First export and verify every raw table plus schema metadata, then migrate the last QC dependency from `raw_all1_code_set` to `rx_qc_all1_code_set`, prove QC is raw-free, and only then drop all live `raw_*` tables. The repo remains reproducible through exported snapshots and documented restore/re-import paths.

**Tech Stack:** Python, psycopg, Postgres/Supabase, pytest, Markdown docs

---

### Task 1: Export And Verify Raw Snapshots

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\outputs\exports\raw_export_manifest.json`
- Create: `e:\TRAE\Projects\RxNorm\outputs\exports\raw_schema.sql`

- [ ] Run live size and raw rowcount queries.
- [ ] Export `raw_nhi_items`, `raw_tfda_permits_active`, `raw_tfda_permits_all`, `raw_atc_ddd`, and `raw_all1_code_set`.
- [ ] Verify exported rowcounts match live counts.
- [ ] Spot-check key values for each export.
- [ ] Record manifest + schema snapshot.

### Task 2: Migrate QC To Curated-Tier All1 Table

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\etl\curated_repository.py`
- Modify: `e:\TRAE\Projects\RxNorm\etl\qc_report.py`
- Modify: `e:\TRAE\Projects\RxNorm\supabase\migrations\202605130001_raw_schema.sql`
- Modify: `e:\TRAE\Projects\RxNorm\supabase\migrations\202605130002_curated_schema.sql`
- Test: `e:\TRAE\Projects\RxNorm\tests\test_qc_report.py`
- Test: `e:\TRAE\Projects\RxNorm\tests\test_migrations.py`

- [ ] Write failing tests for `rx_qc_all1_code_set`.
- [ ] Update QC/repository/schema code to use `rx_qc_all1_code_set`.
- [ ] Run focused tests to verify the swap.
- [ ] Regenerate QC and confirm metrics are unchanged.

### Task 3: Drop Live Raw Tables

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\docs\supabase_storage_policy.md`

- [ ] Confirm all export and QC gates are satisfied.
- [ ] Drop every live `raw_*` table.
- [ ] Run `VACUUM (ANALYZE)`.
- [ ] Re-run biggest-table query and post-drop QC.
- [ ] Update operator docs with the raw-free Supabase policy.
