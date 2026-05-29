# Tasks
- [x] Task 1: Bootstrap the Supabase project structure and operator configuration.
  - [x] Create the repository folders for Supabase migrations, ETL/import scripts, QC scripts, and supporting documentation.
  - [x] Add `.env.example` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL`.
  - [x] Document the expected dataset locations under `Datasets/` and how the scripts discover them.

- [x] Task 2: Implement idempotent schema migrations for the raw ingestion layer.
  - [x] Create migrations for `rx_import_batches`.
  - [x] Create migrations for `raw_nhi_items`, `raw_tfda_permits_all`, `raw_tfda_permits_active`, `raw_atc_ddd`, `raw_all1_price_history`, and `raw_nhi_component_map`.
  - [x] Type stable keys and important numeric fields while preserving unknown source fields as text where needed.
  - [x] Add import-batch foreign keys and raw-table indexes required for downstream rebuilds.

- [x] Task 3: Implement idempotent schema migrations for the curated Taiwan RxNorm layer.
  - [x] Create migrations for `rx_drug_products`, `rx_ingredient_concepts`, `rx_product_ingredients`, `rx_name_variants`, `rx_tfda_permits`, `rx_nhi_tfda_map`, `rx_atc_reference_latest`, and `rx_review_queue`.
  - [x] Add primary keys, foreign keys, uniqueness rules, and the indexes required by the guide.
  - [x] Create `rx_product_enriched_v` and any helper SQL functions required for normalization or aggregation.

- [x] Task 4: Build shared ETL utilities for parsing, normalization, and batch tracking.
  - [x] Implement reusable helpers to open CSV/TXT inputs, normalize text, parse dates and numerics, and record import batch metadata.
  - [x] Implement TFDA permit extraction from the NHI hyperlink field.
  - [x] Implement ingredient splitting rules for TFDA `主成分略述` using `;;` separators and preserved originals.

- [x] Task 5: Implement raw import scripts for every required dataset.
  - [x] Import `A21030000I-E41001-001.csv` into `raw_nhi_items`.
  - [x] Import `A21030000I-E41002-002.csv` into `raw_nhi_component_map` when present.
  - [x] Import `36_2.csv` into `raw_tfda_permits_all` and `37_2.csv` into `raw_tfda_permits_active`.
  - [x] Import `ATC_DDD_fabkury_merged.csv` into `raw_atc_ddd`.
  - [x] Parse `all1_11505_1.TXT` and `all1_11505_2.TXT` into `raw_all1_price_history` as validation/history records only.

- [x] Task 6: Implement the curated rebuild pipeline.
  - [x] Derive product-level rows in `rx_drug_products` from NHI data using the latest relevant record shape required by the app.
  - [x] Build `rx_ingredient_concepts` and `rx_product_ingredients` from normalized NHI and TFDA ingredient evidence.
  - [x] Build `rx_tfda_permits` and `rx_nhi_tfda_map` from TFDA data and NHI permit links.
  - [x] Build `rx_name_variants` for ingredient and product aliases.
  - [x] Derive `rx_atc_reference_latest` from the most recent snapshot per ATC code.

- [x] Task 7: Implement mismatch handling and review-queue generation.
  - [x] Compare normalized NHI ingredient text with TFDA ingredient evidence for mapped products.
  - [x] Apply the confidence threshold and create `rx_review_queue` rows for low-confidence disagreements.
  - [x] Ensure the pipeline never silently replaces uncertain ingredient mappings.

- [x] Task 8: Implement the batch release strategy for curated data refreshes.
  - [x] Rebuild curated outputs into staging tables or an equivalent release boundary.
  - [x] Swap or publish the rebuilt curated state atomically enough for repeatable batch refreshes.
  - [x] Preserve raw provenance and make review-queue updates incremental where practical.

- [x] Task 9: Implement QC reporting and operator verification outputs.
  - [x] Generate coverage metrics for ingredient mapping, TFDA joins, ATC presence, and ATC latest-reference joins.
  - [x] Calculate all1 overlap counts against NHI codes.
  - [x] Export top TFDA mismatch examples in markdown and/or CSV form.

- [x] Task 10: Document local execution, Supabase deployment, and validation workflow.
  - [x] Write a short README covering prerequisites, environment setup, migrations, imports, curated rebuild, and QC execution.
  - [x] Document how to run the workflow locally and how to target a Supabase project.
  - [x] Add example SQL verification queries for raw tables, curated tables, the enriched view, and mismatch/review records.

- [x] Task 11: Validate the implementation end to end.
  - [x] Run migrations against a local or Supabase-connected database.
  - [x] Execute imports for the provided datasets in `Datasets/`.
  - [x] Run the curated rebuild and QC scripts.
  - [x] Confirm that outputs satisfy every checkpoint in `checklist.md`.

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 2] and [Task 4]
- [Task 6] depends on [Task 3] and [Task 5]
- [Task 7] depends on [Task 6]
- [Task 8] depends on [Task 6]
- [Task 9] depends on [Task 6] and [Task 7]
- [Task 10] depends on [Task 5], [Task 6], and [Task 9]
- [Task 11] depends on [Task 8], [Task 9], and [Task 10]
