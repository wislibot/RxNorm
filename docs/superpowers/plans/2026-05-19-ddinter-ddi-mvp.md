# DDInter DDI MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add curated-tier DDInter DDI storage, conservative exact-only ingredient mapping, import/QC tooling, and documentation without introducing any `raw_*` tables in Supabase.

**Architecture:** Add a curated migration for severity templates, name-map curation state, and ingredient-rooted DDI pairs. Implement a dedicated DDInter import CLI that loads durable name-map rows, auto-maps only on exact canonical or exact alias matches, then loads ordered ingredient pairs and writes QC outputs. Keep all DDInter source files external to Supabase and document the case-evaluation contract for the app.

**Tech Stack:** Python, psycopg, Postgres/Supabase, pytest, Markdown docs

---

### Task 1: Curated DDI Schema

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\supabase\migrations\202605190003_add_ddi_tables.sql`
- Test: `e:\TRAE\Projects\RxNorm\tests\test_migrations.py`

- [ ] Add `rx_ddi_severity_templates`, `rx_ddi_name_map`, and `rx_ddi_pairs`
- [ ] Seed severity template rows for `major`, `moderate`, and `minor`
- [ ] Make template columns bilingual-ready
- [ ] Add FK, unique, index, and pair-ordering protections
- [ ] Extend migration tests

### Task 2: DDInter Import CLI

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\etl\import_ddi_ddinter.py`
- Modify: `e:\TRAE\Projects\RxNorm\etl\utils.py`
- Test: `e:\TRAE\Projects\RxNorm\tests\test_import_ddi_ddinter.py`

- [ ] Write failing tests for exact canonical match, exact alias match, ambiguity no-map, ordered pair writes, and both-sides-mapped gating
- [ ] Implement conservative DDInter normalization and exact mapping helpers
- [ ] Implement durable `rx_ddi_name_map` upsert behavior with manual-map preservation
- [ ] Implement `rx_ddi_pairs` upsert with highest-severity retention and merged source detail
- [ ] Run focused import tests

### Task 3: QC And Docs

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\docs\supabase_storage_policy.md`
- Create: `e:\TRAE\Projects\RxNorm\docs\ddi.md`
- Test: `e:\TRAE\Projects\RxNorm\tests\test_import_ddi_ddinter.py`

- [ ] Write QC outputs to `e:\TRAE\Projects\RxNorm\outputs\qc-ddi\`
- [ ] Add JSON, Markdown, and top-unmapped CSV artifacts
- [ ] Document DDInter storage policy and app evaluation contract
- [ ] Run focused DDI tests and the existing related slice

### Task 4: Live Import And Verification

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\outputs\qc-ddi\ddi_mapping_summary.json`
- Create: `e:\TRAE\Projects\RxNorm\outputs\qc-ddi\ddi_pairs_summary.json`

- [ ] Apply the migration to Supabase
- [ ] Run `python -m etl.import_ddi_ddinter --names <path> --pairs <path>`
- [ ] Verify mapped-name coverage and loaded pair counts
- [ ] Report severity counts and top unmapped names
