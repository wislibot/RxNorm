# DDI

## Overview

This project computes drug-drug interaction (DDI) results from ingredient sets, not from product pairs.

The current curated DDI source is DDInter. DDInter drug names are conservatively mapped to Taiwan RxNorm ingredient concepts, and only mapped ingredient pairs are retained in `rx_ddi_pairs`.

## How DDI Is Computed

1. Start with the medication case input.
   - The app can accept a set of `ingredient_id` values directly.
   - The app can also accept a set of `nhi_code` values and expand them through `rx_product_ingredients`.
   - The app may also carry OCR or free-text items that did not map cleanly; these stay outside the checked ingredient set.
2. Build the distinct ingredient set for the case.
3. Generate all unordered ingredient pairs from that set.
4. Look up matching pairs in `rx_ddi_pairs`.
5. Return the stored severity plus any accompanying template or disclaimer text from `rx_ddi_severity_templates`.

This keeps the DDI logic stable even when multiple products resolve to the same active ingredients.

## Coverage-Aware Output

The app should always distinguish medicines that were actually checked from medicines that could not be checked.

The coverage-aware evaluator returns:

- `checked_ingredient_count`
- `unchecked_ingredient_count`
- `checked_ingredients`
- `unchecked_items`
- `interactions_found_count`
- `interactions`
- `coverage_disclaimer_en`

Unchecked items are reported conservatively:

- `unknown_product`
  - an `nhi_code` that did not resolve to any curated ingredients
  - an OCR/free-text token that never mapped to a product
- `missing_ingredient_concept`
  - an explicit `ingredient_id` input that does not exist in `rx_ingredient_concepts`

## Frontend Messaging Rules

1. If `interactions_found_count > 0`:
   - show interaction cards
2. If `interactions_found_count == 0` and `unchecked_ingredient_count == 0`:
   - show: `No interactions found among the checked medicines.`
3. If `unchecked_ingredient_count > 0`:
   - show a warning banner:
     `Some medicines could not be checked for interactions. Confirm with a clinician/pharmacist.`
4. Always show the coverage disclaimer.

## Example Response

```json
{
  "checked_ingredient_count": 2,
  "unchecked_ingredient_count": 1,
  "checked_ingredients": [
    {
      "ingredient_id": "11111111-1111-1111-1111-111111111111",
      "canonical_name": "ALPHA"
    },
    {
      "ingredient_id": "22222222-2222-2222-2222-222222222222",
      "canonical_name": "BETA"
    }
  ],
  "unchecked_items": [
    {
      "reason": "unknown_product",
      "raw_text": "blurred OCR token",
      "nhi_code": null
    }
  ],
  "interactions_found_count": 1,
  "interactions": [
    {
      "ingredient_a_id": "11111111-1111-1111-1111-111111111111",
      "ingredient_b_id": "22222222-2222-2222-2222-222222222222",
      "severity": "moderate",
      "patient_title_en": "Use with caution",
      "patient_message_en": "These medicines may interact. Ask your doctor or pharmacist whether you need extra monitoring or dose changes.",
      "staff_title_en": "Moderate interaction",
      "staff_message_en": "Use caution with coadministration and consider monitoring, counseling, or dose adjustment based on the clinical context.",
      "recommended_action": "Review benefits and risks, consider dose adjustment or monitoring, and counsel the patient about interaction symptoms.",
      "disclaimer_en": "This information supports, but does not replace, clinical judgment and patient-specific review."
    }
  ],
  "coverage_disclaimer_en": "DDI screening coverage is limited to medicines in the Taiwan curated dictionary. If some medicines could not be checked, confirm with a clinician/pharmacist."
}
```

## Source And Curation Rules

- DDInter source CSV files stay external to Supabase in the workspace datasets area.
- `rx_ddi_name_map` is the curated mapping surface for DDInter names to ingredient concepts.
- Automatic mapping uses exact canonical-name matches first, then exact alias matches.
- Names with zero matches or multiple matches remain unmapped for manual review.
- `rx_ddi_pairs` stores only ingredient pairs where both DDInter names mapped successfully.

## Disclaimer

DDI output in this project is a curated decision-support aid, not a substitute for clinical judgment.

Coverage is limited to the DDInter-derived ingredient pairs that were successfully mapped into the curated layer. Missing interactions, incomplete mappings, source limitations, and terminology differences can all affect results.

Any clinical use should include appropriate pharmacist or physician review, especially for high-risk patients, polypharmacy cases, renal or hepatic impairment, pregnancy, pediatrics, and other contexts where interaction significance may vary.
