# DDInter DDI MVP Design

## Goal

Add a curated-tier DDI capability backed by DDInter so the project can map DDInter drug names to ingredient concepts conservatively, store ingredient-rooted interaction pairs in Supabase, and generate QC outputs for mapping coverage and loaded pair severity counts.

## Scope

- Add curated-tier DDI tables in Supabase.
- Import precombined DDInter name and pair files through a repo CLI.
- Auto-map only with safe exact rules using canonical names and the existing alias layer.
- Load DDI pairs only when both sides map to ingredients.
- Generate QC outputs for mapping coverage and loaded pair counts.

## Non-Goals

- No fuzzy automatic mapping.
- No ATC-based DDI logic for MVP.
- No product-level DDI storage; all stored interactions remain ingredient-rooted.

## Data Model

### `rx_ddi_severity_templates`

- FK-backed severity dictionary for `major`, `moderate`, `minor`
- Stores patient/staff guidance and disclaimer text
- Structured to be bilingual-ready by reserving parallel zh columns now, even if seeded empty in MVP

### `rx_ddi_name_map`

- Durable curated support table keyed by `ddinter_drug_name`
- Holds DDInter IDs, occurrence counts, mapped ingredient, match method, notes, and update timestamp
- Serves as the long-term manual curation surface

### `rx_ddi_pairs`

- Ingredient-rooted pair table
- Stores ordered ingredient IDs, severity, source, source detail, and merged-row count
- Ordering enforced in Python by UUID string compare, with a DB check if practical
- Unique on `(ingredient_a_id, ingredient_b_id, source)`

## Import Rules

### Names

1. Insert or update `rx_ddi_name_map` rows from `ddinter_drug_names_unique.csv`
2. Preserve existing manual mappings unless a force flag is explicitly used
3. Auto-map conservatively:
   - exact canonical match against `rx_ingredient_concepts.canonical_name_normalized`
   - exact alias match against `rx_name_variants.normalized_text` where `target_type='ingredient'`
4. If zero or multiple candidates exist, leave unmapped

### Pairs

1. Read `ddinter_pairs_combined_dedup.csv`
2. Look up both DDInter drug names in `rx_ddi_name_map`
3. Only load rows when both sides have `ingredient_id`
4. Normalize ordering with UUID string compare so `ingredient_a_id < ingredient_b_id`
5. Normalize severity `Major|Moderate|Minor` to `major|moderate|minor`
6. Upsert and keep the highest severity when duplicates collide

## QC

Write artifacts to `outputs/qc-ddi/`:

- mapping summary JSON + Markdown
- top unmapped names CSV
- pair summary JSON + Markdown

Metrics:

- total unique DDInter names
- mapped names and mapped percent
- top unmapped names by occurrence
- total pairs in file
- mapped pairs inserted
- severity counts by `major|moderate|minor`

## App Contract Note

DDI evaluation for a medication case:

1. Accept `nhi_code` list or `ingredient_id` list
2. Expand `nhi_code` through `rx_product_ingredients` when needed
3. Evaluate all unordered ingredient pairs against `rx_ddi_pairs`
4. Return severity and template strings from `rx_ddi_severity_templates`

## Acceptance Criteria

1. Migration applies cleanly
2. Import command loads DDInter names and safely auto-maps a subset
3. `rx_ddi_pairs` only contains pairs where both sides mapped
4. QC outputs are generated with mapping coverage and severity distribution
5. Existing focused tests and new DDI tests pass
