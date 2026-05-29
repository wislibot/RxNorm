You are an expert full‑stack data engineer. Help me build a Supabase (Postgres) database for a “Taiwan RxNorm” project (remote-area medical intelligent services). I want an ingredient-rooted medication dictionary for Taiwan, built primarily from NHI + TFDA datasets, and enriched with ATC/DDD. I will also maintain update/versioning and QC checks.

### 0) Context and decisions (must follow)

**Project objective**

- Build a Taiwan “RxNorm-like” terminology: everything resolves to **active ingredient root concept(s)**.
- Support remote workflow: photo/OCR → text normalization → match → ingredient root + confidence → review queue if uncertain.

**Source-of-truth choices**

- **Main drug dictionary**: `A21030000I-E41001-001.csv` (NHI drug items). This is the primary product list keyed by NHI drug code.
- **TFDA permits**: TFDA drug license datasets (for regulatory truth + ingredient verification). TFDA does **not** include NHI codes or ATC codes directly; we link via NHI’s TFDA hyperlink field.
- **ATC/DDD**: use a merged, multi-year reference table from `fabkury/atcd` snapshots (ATC codes/names + DDD where available). Used for classification + analytics + QC enrichment.
- **all1\_11505\_\*.TXT.gz**: these are **not** a full product dictionary; treat them as **pricing/effective-date history validation** only.

**Key business rule**

- If NHI and TFDA ingredient info disagree or confidence is low, do **not** silently guess—create a review item.

### 1) Input datasets available (you must support importing these)

1. **NHI main drug items**
   - `A21030000I-E41001-001.csv`
2. **NHI component mapping (optional enrichment)**
   - `A21030000I-E41002-002.csv` (component code mapping)
3. **TFDA permits**
   - `36_2.csv` (all drug permits)
   - `37_2.csv` (uncancelled/active permits)
4. **ATC/DDD reference**
   - `ATC_DDD_fabkury_merged.csv` (multi-snapshot merged file)
5. **NHI history/price files (validation only)**
   - `all1_11505_1.TXT`
   - `all1_11505_2.TXT`

### 2) Deliverables you must produce in this repo

Create the following in my codebase:

1. **Supabase SQL migrations** (idempotent) to create schemas/tables/functions/indexes.
2. **Data import scripts** (Python or Node) that load the above datasets into “raw” tables then build “curated” tables.
3. **QC report script** that outputs a small markdown/CSV summary (coverage, mismatches, missing joins).
4. Documentation: a short README explaining how to run migrations + imports locally and on Supabase.

### 3) Supabase setup steps (explain, then implement)

1. Create a Supabase project.
2. Obtain connection string + service role key.
3. In my repo, create `.env.example` with required env vars:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL` (or Supabase Postgres connection string)
4. Provide commands to run migrations and imports.

### 4) Database design (must implement)

Use **two layers**:

- `raw_*` tables: store datasets close to original columns.
- `rx_*` curated tables: the “Taiwan RxNorm” dictionary and workflows.

#### 4.1 Raw tables (minimal required)

Create raw tables with a stable import batch concept:

- `rx_import_batches`
  - `import_batch_id` (uuid, pk)
  - `source_name` (text) e.g. `nhi_items`, `tfda_36`, `tfda_37`, `atc_ddd`, `all1`
  - `source_version` (text, nullable) e.g. `2026-04-25` or file date
  - `imported_at` (timestamptz)
  - `row_count` (int)
  - `notes` (text)

Raw tables (store `import_batch_id`):

- `raw_nhi_items`
- `raw_tfda_permits_all`
- `raw_tfda_permits_active`
- `raw_atc_ddd` (from `ATC_DDD_fabkury_merged.csv`)
- `raw_all1_price_history` (parsed output from gz; store code, price, start/end, name)
- `raw_nhi_component_map` (optional)

Implementation note: you do NOT have to perfectly type every raw column; use `text` for unknowns, but keep keys and important numeric fields typed.

#### 4.2 Curated “Taiwan RxNorm” tables (MVP)

These are the tables my app should query.

1. `rx_drug_products` (NHI product-level)

- `nhi_code` (text, pk)  ← from NHI `藥品代號`
- `name_zh` (text)
- `name_en` (text)
- `ingredient_text_nhi` (text)
- `dose_form` (text)
- `strength_value` (numeric, nullable)
- `strength_unit` (text, nullable)
- `is_combo` (text/boolean, nullable)
- `atc_code` (text, nullable)
- `tfda_link` (text, nullable) ← from NHI `藥品代碼超連結`
- `price_nhi` (numeric, nullable)
- `effective_start` (text or date, nullable)
- `effective_end` (text or date, nullable)
- `updated_at` (timestamptz)

1. `rx_ingredient_concepts` (ingredient-root concepts; our “TW-RxCUI-style”)

- `ingredient_id` (uuid, pk)
- `canonical_name` (text)  ← normalized ingredient root string (your rules)
- `created_at`, `updated_at`

1. `rx_product_ingredients` (many-to-many; supports combination drugs)

- `nhi_code` (text, fk → rx\_drug\_products)
- `ingredient_id` (uuid, fk → rx\_ingredient\_concepts)
- `role` (text, nullable) (active, salt, etc.)
- `strength_value` (numeric, nullable)
- `strength_unit` (text, nullable)
- `source` (text) (`nhi`, `tfda`, `merged`)
- PK: (`nhi_code`, `ingredient_id`, `source`)

1. `rx_name_variants` (alias layer)

- `variant_id` (uuid, pk)
- `target_type` (text: `ingredient` | `product`)
- `target_id` (text/uuid depending on type)
- `variant_text` (text)
- `normalized_text` (text)
- `language` (text: `zh`/`en`/`mixed`)
- `variant_type` (text: `brand_alias`, `ingredient_alias`, `ocr_alias`, etc.)
- `source` (text)

1. `rx_tfda_permits` (regulatory enrichment)

- `tfda_permit_no` (text, pk) ← from TFDA `許可證字號` (or “Permit number”)
- `is_cancelled` (text/boolean, nullable)
- `cancel_date` (text/date, nullable)
- `expiry_date` (text/date, nullable)
- `issue_date` (text/date, nullable)
- `controlled_substance_level` (text, nullable)
- `product_name` (text, nullable)
- `dosage_form` (text, nullable)
- `packaging` (text, nullable)
- `ingredient_text_tfda` (text, nullable) ← from TFDA “主成分略述”
- manufacturer/applicant fields (text, nullable)

1. `rx_nhi_tfda_map` (bridge table)

- `nhi_code` (text, fk)
- `tfda_permit_no` (text, fk)
- `link_source` (text) (e.g., extracted from `tfda_link`)
- PK: (`nhi_code`, `tfda_permit_no`)

1. `rx_atc_reference_latest`

- `atc_code` (text, pk)
- `atc_name` (text)
- `ddd` (text/numeric nullable)
- `uom` (text nullable)
- `adm_r` (text nullable)
- `note` (text nullable)
- `snapshot_date` (date/text) (the chosen “latest”)

1. Review / human-in-the-loop tables

- `rx_review_queue`
  - `review_id` (uuid pk)
  - `created_at`
  - `source` (text: `ocr`, `tfda_mismatch`, `unknown_brand`, etc.)
  - `nhi_code` (text nullable)
  - `tfda_permit_no` (text nullable)
  - `input_text` (text nullable)
  - `ocr_text` (text nullable)
  - `candidate_ingredient_ids` (uuid\[] nullable)
  - `confidence` (numeric nullable)
  - `status` (text: `pending`, `approved`, `rejected`)
  - `review_notes` (text nullable)

#### 4.3 Views for the app (recommended)

Create a view `rx_product_enriched_v` that joins:

- `rx_drug_products`
- `rx_product_ingredients` aggregated
- `rx_nhi_tfda_map` + `rx_tfda_permits`
- `rx_atc_reference_latest`
  So the app can query one view for display.

### 5) Parsing + normalization rules (must implement)

1. Ingredient parsing

- TFDA `主成分略述` may contain multiple ingredients separated by `;;`.
- Split into ingredient strings, normalize whitespace/case, keep the original.
- Create/lookup `rx_ingredient_concepts` by `canonical_name`.

1. Name normalization for matching

- store `normalized_text` (uppercase, trim, collapse spaces, strip punctuation where appropriate).

1. TFDA verification logic

- For each NHI product with TFDA mapping, compare:
  - NHI ingredient string vs TFDA ingredient list (after normalization)
- If mismatch and confidence below threshold → add a row to `rx_review_queue` with `source='tfda_mismatch'`.

### 6) QC checks (must implement)

Generate a QC summary with:

- Coverage: % of NHI products mapped to ≥1 ingredient concept
- Join coverage: % of NHI products linked to TFDA permit
- ATC coverage: % of NHI products with valid ATC code; % that successfully join to `rx_atc_reference_latest`
- all1 overlap: how many NHI codes appear in all1 (history)
- Top mismatch examples (first N) for TFDA ingredient disagreements

### 7) Update strategy (must implement lightly)

Implement a simple versioning pattern:

- New data loads into `raw_*` with a new `import_batch_id`.
- Curated tables are rebuilt into staging tables, then swapped (or use `rx_release_versions` and views).
- Do **not** rebuild everything on every single new record; support batch refresh (weekly/monthly) and incremental review queue updates.

### 8) Constraints and indexing (must implement)

Add indexes for:

- `rx_drug_products(name_zh)`, `rx_drug_products(name_en)` (btree or trigram if you add pg\_trgm)
- `rx_name_variants(normalized_text)`
- `rx_product_ingredients(ingredient_id)`
- `rx_tfda_permits(tfda_permit_no)`
- `rx_drug_products(atc_code)`

If you implement fuzzy search, enable `pg_trgm` and add trigram indexes on normalized text.

### 9) Security (Supabase)

For MVP:

- keep tables private; expose only the view(s) needed by the app via RLS policies later.
- Use service role key for back-office ETL only (never ship it to client).

### 10) Execution plan (what you should do first)

1. Implement migrations + schema.
2. Import NHI + TFDA + ATC/DDD into raw tables.
3. Build curated dictionary tables.
4. Produce QC report.

Return:

- file tree you created
- how to run it locally
- how to deploy to Supabase
- example queries (SQL) to verify data.

***

## Notes for the implementer (important)

- Keep the DB Taiwan-first: NHI/TFDA are truth; ATC/DDD is enrichment.
- all1 is not a full dictionary; use it as history/QC only.
- Always support combination drugs using a junction table (many-to-many).
- Store provenance (`source`, `import_batch_id`, snapshot dates) to support update runs and debugging.

