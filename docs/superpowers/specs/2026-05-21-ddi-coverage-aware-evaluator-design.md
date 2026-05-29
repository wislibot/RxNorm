# DDI Coverage-Aware Evaluator Design

## Goal

Add a small backend helper that evaluates DDI for a medication case while making coverage explicit, so the app never implies "safe" when some medicines could not be checked.

## Scope

- Add `etl/ddi_case_evaluator.py`
- Support case evaluation from `nhi_code` values and direct `ingredient_id` values
- Return a deterministic JSON-ready response with:
  - checked ingredients
  - unchecked items
  - interaction results
  - coverage disclaimer
- Update `docs/ddi.md` with frontend-safe messaging rules and an example response
- Add focused unit tests with a fake repository

## Non-Goals

- No fuzzy mapping changes
- No SQL-side pair generation
- No API server or endpoint implementation in this pass

## Evaluation Rules

1. Resolve `nhi_code` inputs through `rx_product_ingredients`
2. Treat unresolved products or OCR-only items as unchecked
3. Treat missing direct `ingredient_id` concepts as unchecked
4. Sort checked ingredients deterministically before generating unordered pairs
5. Generate unordered pairs in Python only
6. Fetch only matching DDI pairs from `rx_ddi_pairs`
7. Join severity template text from `rx_ddi_severity_templates`
8. Always return counts and disclaimer, even when no interactions are found

## Response Shape

- `checked_ingredient_count`
- `unchecked_ingredient_count`
- `checked_ingredients`
- `unchecked_items`
- `interactions_found_count`
- `interactions`
- `coverage_disclaimer_en`

## Acceptance Criteria

1. Known mapped ingredient pairs return interactions plus severity template fields
2. Unknown products or unmapped inputs increase `unchecked_ingredient_count`
3. No-interaction cases still return counts and disclaimer
4. Outputs are deterministic across runs for the same input set
