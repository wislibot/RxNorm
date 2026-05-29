# DDInter Manual Name-Map Patch Design

## Goal

Add a small idempotent patch CLI that seeds 14 approved manual DDInter-to-ingredient mappings into `rx_ddi_name_map`, then reuse the existing DDInter importer to preserve those mappings and regenerate DDI QC outputs.

## Scope

- Add `etl/patch_ddi_name_map_manual.py`
- Upsert the 14 approved mappings by `ddinter_drug_name`
- Preserve existing mapped rows unless `--force` is passed
- Reuse `etl.import_ddi_ddinter` for the post-patch import and QC refresh
- Compare QC before/after for mapping coverage and mapped pair counts

## Non-Goals

- No new fuzzy matching or alias heuristics
- No schema changes
- No expansion beyond the 14 explicitly approved manual mappings

## Patch Rules

1. Use a static in-code mapping list containing:
   - `ddinter_drug_name`
   - `ingredient_id`
   - optional `ddinter_ids`
   - note text: `manual map (base-name->salt/hydrate form)`
2. Upsert by `ddinter_drug_name`
3. Without `--force`, only set `ingredient_id` when the current row is missing one
4. Always set `match_method='manual'` for patched rows that receive the manual mapping
5. Preserve other existing metadata where practical, especially `ddinter_ids` and `occurrences_in_pairs`

## Workflow

1. Run `python -m etl.patch_ddi_name_map_manual`
2. Run `python -m etl.import_ddi_ddinter --names Datasets/DDI/ddinter_drug_names_unique.csv --pairs Datasets/DDI/ddinter_pairs_combined_dedup.csv`
3. Read refreshed `outputs/qc-ddi/` summaries
4. Report before/after deltas for:
   - `mapped_names`
   - `mapped_pct`
   - `pairs_inserted_mapped`
   - `major|moderate|minor`

## Testing

- Add focused tests for the patch CLI behavior:
  - inserts missing manual mappings
  - does not overwrite an existing `ingredient_id` without `--force`
  - overwrites when `--force` is passed
- Re-run focused DDI tests, then the full suite

## Acceptance Criteria

1. The patch CLI is idempotent
2. Existing importer keeps patched manual mappings on rerun
3. QC artifacts refresh successfully
4. Mapping coverage increases from the pre-patch baseline
5. Focused DDI tests and full test suite pass
