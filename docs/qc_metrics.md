# QC Metrics

## `all1_overlap_pct`

`all1_overlap_pct` is defined as:

`overlap_distinct_codes / nhi_distinct_codes`

Where:

- `nhi_distinct_codes` = distinct `rx_drug_products.nhi_code`
- `all1_distinct_codes` = distinct `rx_qc_all1_code_set.nhi_code`
- `overlap_distinct_codes` = distinct codes present in both sets

## Why It Can Reach 100%

The current `all1` QC support table is `rx_qc_all1_code_set`, and the live dataset on 2026-05-19 contains:

- `nhi_distinct_codes = 45038`
- `all1_distinct_codes = 45044`
- `overlap_distinct_codes = 45038`
- `all1_only_distinct_codes = 6`

That means every curated NHI code appears at least once in `all1`, so the overlap percentage is legitimately `100%` for the current dataset.

## How To Interpret It

- `all1_overlap_pct = 100%` means every curated NHI code appears at least once in `all1`.
- It does **not** mean the sets are identical.
- Use the debug fields together:
  - `nhi_distinct_codes`
  - `all1_distinct_codes`
  - `overlap_distinct_codes`
  - `all1_only_distinct_codes`

If `all1_distinct_codes > overlap_distinct_codes`, then `all1` still contains extra codes beyond curated, even when `all1_overlap_pct` is `100%`.
