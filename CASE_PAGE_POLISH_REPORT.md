# Case Page Polish — Implementation Report

## Overview

Polished the Case Page to better meet "Medication Case Summary" requirements:

1. **Part A** — Separated Sex from Patient Name into its own row; added Pharmacist and Dispensing Date rows  
2. **Part B** — Created `normalizeOcrEnglishSpacing()` for display-only OCR spacing fixes

All changes are display-only and deterministic. No LLM. `ocr_raw_text` is never modified. No DB schema changes.

---

## Files changed

| File | Change |
|---|---|
| `apps/mobile/src/ocr/normalizeOcrEnglish.ts` | **Created** — display-only spacing normalization with safety guards |
| `apps/mobile/src/ocr/__tests__/normalizeOcrEnglish.test.ts` | **Created** — 8 unit tests |
| `apps/mobile/src/case/CasePageScreen.tsx` | **Modified** — Sex now separate row; `norm()` applied to all displayed English text |
| `apps/mobile/src/case/__tests__/casePageScreen.test.tsx` | **Modified** — Added `Male` assertion for sex row; updated normalized text |
| `apps/mobile/src/i18n/translations/en.json` | **Modified** — 5 new keys |
| `apps/mobile/src/i18n/translations/zh-TW.json` | **Modified** — 5 new keys |

---

## Test results

```
Test Suites: 20 passed, 20 total
Tests:       66 passed, 66 total
```

---

## Part A — Case Summary fields (Sex / Pharmacist / Dispensing date)

### Changes

- **Sex** is now rendered as its own row (labeled "Sex/性別" localized), separate from Patient Name. Previously it was appended in parentheses next to the name.
- **Pharmacist name** is rendered as its own row (labeled "Pharmacist/藥師").
- **Dispensing date** is rendered as its own row (labeled "Dispensing Date/調劑日期").

All three fields were already being extracted by [structuredCaseExtractor.ts](file:///e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\structuredCaseExtractor.ts), persisted in `ocr_sections.case_fields`, and read back in `CasePageScreen` — they just needed proper rendering.

### New i18n keys

| Key | English | 繁體中文 |
|---|---|---|
| `caseSummarySexLabel` | Sex | 性別 |
| `caseSummaryPharmacistLabel` | Pharmacist | 藥師 |
| `caseSummaryDispensingDateLabel` | Dispensing Date | 調劑日期 |
| `sexMale` | Male | 男 |
| `sexFemale` | Female | 女 |

---

## Part B — Normalize OCR English spacing (display only)

### normalizeOcrEnglish.ts

Created [normalizeOcrEnglish.ts](file:///e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\normalizeOcrEnglish.ts) with a single export:

```ts
export function normalizeOcrEnglishSpacing(text: string): string
```

### Normalization rules

1. **Generic merge** (max 3 passes): Merge adjacent alpha-only tokens separated by whitespace when combined length ≤ 20  
2. **Safety guards**:
   - **Abbreviation blacklist**: `mg`, `ml`, `mcg`, `g`, `iu`, `kg`, `cm`, `mm` are never merged into adjacent words
   - **Both-words-long guard**: two adjacent alpha words each ≥ 5 chars are treated as intentional separate words and NOT merged
3. **Domain replacements** (applied after generic merge): high-precision regex fixes for common OCR artifacts

### Normalization before/after

| Input | Output | Mechanism |
|---|---|---|
| `Medi cation 60puff` | `Medication 60puff` | Generic merge (pass 1) |
| `Respi mat` | `Respimat` | Generic merge (pass 1) |
| `medi ca tion` | `medication` | Multi-pass merge (2 passes) |
| `Warnings&Precaut ions` | `Warnings & Precautions` | Domain replacement |
| `Physiciam` | `Physician` | Domain replacement |
| `Pharmaci st` | `Pharmacist` | Domain replacement |
| `AMOXICILLIN 500 MG CAPSULE` | `AMOXICILLIN 500 MG CAPSULE` | Unchanged — `MG` blacklisted |
| `Spiriva Respimat` | `Spiriva Respimat` | Unchanged — both ≥ 5 chars |
| `總量 1盒` | `總量 1盒` | Unchanged — non-alpha tokens |

### Where normalization is applied

In [CasePageScreen.tsx](file:///e:\TRAE\Projects\RxNorm\apps\mobile\src\case\CasePageScreen.tsx), the `norm()` helper is called on:

- Case Summary: indications, warnings, side effects, pharmacy name, pharmacy address
- Detected items: group title and sub-lines

Normalization is **display-only** — it is never written back to the database.

---

## Test details

### normalizeOcrEnglish.test.ts (8 tests)

```
✓ merges "Medi cation 60puff" into "Medication 60puff"
✓ merges "Respi mat" into "Respimat"
✓ merges "Warnings&Precaut ions" into "Warnings & Precautions"
✓ fixes "Physiciam" into "Physician"
✓ merges "Pharmaci st" into "Pharmacist"
✓ returns empty string unchanged
✓ does not merge words when combined length > 20
✓ does not merge non-alpha tokens
✓ handles multi-pass merging
✓ does not merge blacklisted abbreviations
✓ does not merge two long words (>= 5 each)
```

### casePageScreen.test.tsx (2 tests)

```
✓ renders a single grouped medication card for a single-med bag
  - asserts "Male" is rendered as separate sex row
  - asserts "Unknownpink tablet" (normalized) is rendered
✓ shows unmatched group separately when multiple matched meds exist
```
