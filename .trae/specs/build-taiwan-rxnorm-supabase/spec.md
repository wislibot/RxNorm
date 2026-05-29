# Taiwan RxNorm Supabase Build Spec

## Why
The repository currently contains only the implementation guide and source datasets, but no executable Supabase schema, ETL workflow, or validation process. This change defines the minimum end-to-end system required to build a Taiwan-first RxNorm-like medication dictionary rooted in active ingredients and backed by NHI, TFDA, and ATC/DDD data.

## What Changes
- Add idempotent Supabase/Postgres migrations for raw ingestion tables, curated `rx_*` tables, supporting functions, indexes, and the app-facing enriched view.
- Add import tooling that loads all required datasets from `Datasets/` into `raw_*` tables with import batch provenance.
- Add curated build logic that transforms raw datasets into ingredient-rooted product, ingredient, alias, TFDA bridge, ATC reference, and review queue tables.
- Add QC reporting that summarizes ingredient coverage, TFDA join coverage, ATC coverage, all1 overlap, and TFDA ingredient mismatches.
- Add operator documentation for environment variables, migration execution, import execution, Supabase deployment, and verification queries.

## Impact
- Affected specs: data ingestion, terminology normalization, TFDA verification, release/versioning, QC reporting, operator runbook
- Affected code: Supabase migration directory, ETL/import scripts, curated build scripts, QC report scripts, README/setup docs, environment example file

## ADDED Requirements
### Requirement: Supabase Schema For Taiwan RxNorm
The system SHALL create a Supabase-compatible Postgres schema with separate raw ingestion tables and curated application tables for the Taiwan RxNorm workflow.

#### Scenario: Raw and curated tables are provisioned
- **WHEN** the operator runs the migrations on a local Postgres instance or Supabase project
- **THEN** the database contains `rx_import_batches`, the required `raw_*` tables, the required `rx_*` tables, supporting constraints, and indexes
- **AND** the migrations can be re-run without corrupting or duplicating schema objects

### Requirement: Stable Import Batch Provenance
The system SHALL record each dataset load with an import batch identifier and attach that identifier to every imported raw row.

#### Scenario: A dataset import is executed
- **WHEN** an operator imports NHI, TFDA, ATC/DDD, component mapping, or all1 history files
- **THEN** a row is created in `rx_import_batches`
- **AND** imported rows in the corresponding raw table store the `import_batch_id`
- **AND** the batch stores source name, optional version, import timestamp, row count, and notes

### Requirement: Required Dataset Support
The system SHALL support the exact datasets referenced in the implementation guide from the repository `Datasets/` folder.

#### Scenario: All supported files are present
- **WHEN** the import workflow is run against `A21030000I-E41001-001.csv`, `A21030000I-E41002-002.csv`, `36_2.csv`, `37_2.csv`, `ATC_DDD_fabkury_merged.csv`, `all1_11505_1.TXT`, and `all1_11505_2.TXT`
- **THEN** each file is parsed into the appropriate raw table
- **AND** the optional component mapping file enriches the build when present without becoming a hard dependency

### Requirement: Ingredient-Rooted Curated Dictionary
The system SHALL build curated application tables that resolve products to one or more normalized ingredient concepts.

#### Scenario: A single-ingredient NHI product is curated
- **WHEN** a curated rebuild processes an NHI row whose ingredient text identifies one ingredient
- **THEN** the product is stored in `rx_drug_products`
- **AND** one canonical ingredient concept exists in `rx_ingredient_concepts`
- **AND** one linking row exists in `rx_product_ingredients`

#### Scenario: A combination product is curated
- **WHEN** a curated rebuild processes a product whose ingredient text or TFDA ingredient text contains multiple ingredients
- **THEN** multiple ingredient concepts can be linked to the same product through `rx_product_ingredients`
- **AND** the design does not collapse the product into a single ingredient

### Requirement: TFDA Permit Enrichment And Verification
The system SHALL bridge NHI products to TFDA permits using the NHI TFDA hyperlink and compare normalized ingredient evidence.

#### Scenario: TFDA permit mapping succeeds
- **WHEN** a product contains a TFDA hyperlink that can be resolved to a permit number present in TFDA data
- **THEN** the system stores the relationship in `rx_nhi_tfda_map`
- **AND** regulatory fields are available in `rx_tfda_permits`

#### Scenario: Ingredient disagreement is detected
- **WHEN** NHI ingredient text and TFDA ingredient text disagree after normalization and the matching confidence is below the defined threshold
- **THEN** the system does not silently overwrite the ingredient mapping
- **AND** it creates a `rx_review_queue` item with `source='tfda_mismatch'`

### Requirement: Text Normalization And Alias Storage
The system SHALL normalize ingredient and product text for deterministic matching and search support.

#### Scenario: A name variant is generated
- **WHEN** the build process creates an alias from product or ingredient source text
- **THEN** the variant is stored in `rx_name_variants`
- **AND** `normalized_text` is persisted using uppercase, trimmed, whitespace-collapsed, punctuation-stripped normalization rules

### Requirement: Latest ATC Reference Enrichment
The system SHALL derive a latest-snapshot ATC reference table from the merged ATC/DDD source and use it to enrich curated products.

#### Scenario: An NHI product has an ATC code
- **WHEN** the curated build processes a product with a non-empty NHI ATC code
- **THEN** the product stores the ATC code
- **AND** the code is joined against `rx_atc_reference_latest` when a latest-snapshot record exists

### Requirement: Enriched Application View
The system SHALL expose a single enriched view for app read paths.

#### Scenario: The app queries enriched product data
- **WHEN** the app selects from `rx_product_enriched_v`
- **THEN** it receives product fields, aggregated ingredient concepts, TFDA permit enrichment, and ATC reference enrichment in one queryable surface

### Requirement: QC Summary Output
The system SHALL generate a QC report after import and curated rebuild.

#### Scenario: QC reporting runs successfully
- **WHEN** the operator executes the QC reporting script
- **THEN** it outputs a markdown or CSV summary containing ingredient coverage, TFDA join coverage, ATC code coverage, ATC join coverage, all1 overlap counts, and top TFDA mismatch examples

### Requirement: Batch-Oriented Release Strategy
The system SHALL support repeatable batch refreshes without rebuilding curated state for every single record change.

#### Scenario: A new monthly data load is published
- **WHEN** the operator runs a new import batch
- **THEN** raw data is loaded under a new `import_batch_id`
- **AND** curated tables are rebuilt via a staging-and-swap or equivalent release pattern
- **AND** review queue entries can be appended incrementally for newly detected issues

### Requirement: Operator Setup And Deployment Documentation
The system SHALL document local and Supabase execution prerequisites.

#### Scenario: A new operator sets up the repository
- **WHEN** the operator reads the project documentation
- **THEN** the documentation explains required environment variables including `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL`
- **AND** it provides commands to run migrations, imports, curated rebuilds, QC reports, and Supabase deployment verification queries

## MODIFIED Requirements
### Requirement: NHI Data Role
The system SHALL treat `A21030000I-E41001-001.csv` as the primary Taiwan product dictionary keyed by NHI drug code, while `all1_11505_*` files SHALL only be used for price and effective-date history validation rather than as a full dictionary source.

## REMOVED Requirements
### Requirement: Direct TFDA Or ATC Code Source Equivalence
**Reason**: The implementation guide explicitly states that TFDA data does not directly contain NHI codes or ATC codes and therefore cannot serve as the primary product-key source.
**Migration**: Use NHI as the product anchor, extract permit links from the NHI TFDA hyperlink field, and use ATC/DDD only as enrichment and QC reference.
