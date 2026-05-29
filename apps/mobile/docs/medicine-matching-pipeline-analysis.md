# Medicine / Ingredient Detection & Database Matching — Full Analysis

> Generated: 2026-05-27  
> Scope: Analysis only — no code changes  
> Purpose: Understand the pipeline before replacing `structuredCaseExtractor.ts` with a Groq LLM call

---

## 1. File Inventory

### Frontend — Detection & Candidate Preparation

| File | Purpose | Key Exports |
|------|---------|-------------|
| `api/case.ts` | **Central orchestrator.** `createCase()` wires everything together: calls `getMedicationCandidateLines()` → `rx_match_medication_lines` RPC → `rx_match_brand_lines` RPC → builds `detectedItems` + `ingredientIds` → inserts into `rx_cases`. Also calls `extractCaseFields()` for display metadata. | `createCase()`, `getCase()`, `listCases()`, `getMedicationCandidateLines()`, `buildStoredOcrSections()`, `mapMedicationMatchesToDetectedItems()` |
| `detectedItems/extractDetectedItems.ts` | **Fallback medication extractor.** When sectioned OCR yields no medication lines, extracts candidates from raw OCR text using heuristics: dosage/form regex, boilerplate filtering, continuation merging, dedup. Returns `DetectedItem[]` with heuristic confidence scores. | `extractDetectedItems()` |
| `ocr/groupMedicationLines.ts` | **Spatial medication line grouper.** When medication sections have per-line bounding boxes (`OcrLine[]`), performs reading-order-aware merging: groups multi-line entries into `GroupedItem` objects. Handles cross-column inline headers and quantity-only filtering. | `groupMedicationLinesIntoItems()`, `analyzeMedicationLineGrouping()`, `isQuantityOnlyLine()`, `GroupedItem`, `GroupingAttempt`, `MedicationGroupingDiagnostics` |
| `ocr/sectionMapper.ts` | **OCR-to-section mapper.** Detects anchor keywords (藥名, 用法, 警語, etc.) in OCR result bounding boxes and assigns each line to a section. Produces `SectionedOcr` with per-section line arrays — the `medication` section feeds the matching pipeline. | `mapOcrSections()`, `SectionKey`, `SectionEntry`, `SectionedOcr` |
| `ocr/structuredCaseExtractor.ts` | **Field extractor from raw text.** Regex-based extraction of patient info, pharmacy info, dates, and multi-line blocks (directions, indications, warnings, side effects) from `SectionedOcr` sections. Returns `CaseFields`. | `extractCaseFields()`, `extractPhysicianName()`, `extractPharmacistName()`, … |

### Frontend — Type Definitions

| File | Purpose |
|------|---------|
| `types/case.ts` | `DetectedItem`, `OcrSections`, `CaseRecord`, `CreateCaseInput`, `CaseSummary` |
| `types/caseFields.ts` | `CaseFields` (14 fields), `BrandMatch` |
| `types/ddi.ts` | `CaseDdiResult`, `CaseDdiInteraction`, `CheckedIngredient`, `UncheckedItem` |

### Frontend — DDI Screening

| File | Purpose | Key Exports |
|------|---------|-------------|
| `api/ddi.ts` | Takes `ingredientIds[]` (output of medication matching), validates them against `rx_ingredient_concepts`, calls `rx_get_ddi_for_ingredients` RPC. Returns structured DDI results. | `getCaseDdiByIngredients()` |

### Frontend — Screen Components (consumers)

| File | How it uses the pipeline |
|------|-------------------------|
| `scan/CaseDraftScreen.tsx` | Calls `createCase()` on "Create Case" tap. Passes `ocrRawText` + `sectionedOcr` (from `mapOcrSections`). |
| `case/CasePageScreen.tsx` | Loads `CaseRecord` via `getCase(caseId)`. Groups `detectedItems` for display. Calls `getCaseDdiByIngredients(ingredientIds)`. |

### Supabase — RPC Functions (SQL Migrations)

| File | RPC | Purpose |
|------|-----|---------|
| `202605130002_curated_schema.sql` | `rx_normalize_text()` | Normalizes text: uppercase, strip punctuation, collapse spaces. Used by all matching RPCs. |
| `202605130002_curated_schema.sql` | (tables) | `rx_ingredient_concepts` (ingredient_id UUID, canonical_name, normalized name), `rx_name_variants` (aliases for ingredients/products), `rx_product_enriched_v` (product view with ingredient data) |
| `202605220001_add_rx_match_medication_lines_rpc.sql` | `rx_match_medication_lines(text[])` | **Ingredient matching.** 3-pass algorithm: canonical_exact → alias_exact → paren_alias_exact. |
| `202605250001_add_rx_match_brand_lines_rpc.sql` | `rx_match_brand_lines(text[])` | **Brand matching.** 2-pass algorithm: product_exact → alias_exact. |
| `202605210004_add_rx_cases.sql` | `rx_get_ddi_for_ingredients(uuid[])` | **DDI screening.** Finds pairwise interactions for a set of ingredient IDs. |

### Frontend — Test Files

| File | What it tests |
|------|--------------|
| `api/__tests__/case.test.ts` | `createCase` — mocks RPC calls and verifies detected items built with `ingredient_id` |
| `detectedItems/__tests__/extractDetectedItems.test.ts` | `extractDetectedItems` — section-based + raw text extraction, noise filtering |
| `ocr/__tests__/groupMedicationLines.test.ts` | `groupMedicationLinesIntoItems`, `isQuantityOnlyLine` — multi-line grouping, quantity filtering |
| `ocr/__tests__/sectionMapper.test.ts` | `mapOcrSections` — anchor detection, line assignment to sections |
| `scan/__tests__/caseDraftScreen.test.tsx` | `CaseDraftScreen` integration — references `ingredientIds` |

---

## 2. Full Medicine Matching Pipeline (Step by Step)

### Step 1 — OCR → Raw Text

```
runOcrOnImagesStructured(photoUris)
  → sends photo to POST /parse (PaddleOCR PP-StructureV3 server)
  → receives RemoteOcrResult { pages[].elements[] }
  → mapRemoteToOcrResult() produces OcrResult { text, blocks[], modelData }
```

**Data shape:**
```typescript
OcrResult {
  text: "藥名\nAMOXICILLIN 500 MG\n用法\n每日三次\n...",   // joined with \n
  blocks: [{ text: "藥名", frame: {x,y,width,height}, lines: [...] }, ...],
  modelData: { /* raw RemoteOcrResult */ }
}
```

### Step 2 — Section Mapping

```
mapOcrSections(ocrResult)
  → flattenLines() → sortLinesReadingOrder()
  → detectAnchors() → finds "藥名", "用法", "警語", etc.
  → buildRegions() → creates vertical regions between anchors
  → assignLines() → assigns each line to the region with most vertical overlap
  → returns SectionedOcr
```

**Key output for medicine matching:**
```typescript
sectionedOcr.sections.medication = {
  lines: [
    { text: "AMOXICILLIN 500 MG CAPSULE", frame: {x:120, y:60, width:180, height:16} },
    { text: "1顆", frame: {x:120, y:80, width:30, height:16} },
  ],
  texts: ["AMOXICILLIN 500 MG CAPSULE", "1顆"]
}
```

**Note:** `texts` are simple string arrays (line text only, no bbox). `lines` are `OcrLine[]` with full bbox data.

### Step 3 — Medication Candidate Line Preparation

```
getMedicationCandidateLines(input)
  ↓
  Priority 1: analyzeMedicationLineGrouping()
    → Takes sectionedOcr.sections.medication.lines (with bboxes)
    → Groups multi-line entries (e.g., "Spiriva Respimat\n2.5mcg/puff 60puff/bot")
    → Filters quantity-only lines ("1盒")
    → Removes inline header prefixes ("Medication Amoxicillin" → "Amoxicillin")
    → Returns GroupedItem[]
    → Maps to string[]: groupedMedicationItems.map(i => i.text)
  
  Priority 2 (fallback): sectionedOcr.sections.medication.texts
    → Simple string array (no bbox data needed)
    → Trim + filter empty
  
  Priority 3 (last resort): extractDetectedItems()
    → Takes ocrRawText + sectionedOcr
    → Falls back to raw text line splitting
    → Applies heuristics: dosage/form regex, noise filtering, continuation merging
    → Returns DetectedItem[].map(i => i.displayName)
```

**Data shape (output of this step):**
```typescript
medicationLines: string[] = [
  "AMOXICILLIN 500 MG CAPSULE",
  "Spiriva Respimat 2.5mcg/puff 60puff/bot (tiotropium)",
  "PREDNISOLONE 5 MG TAB",
]
```

### Step 4 — Ingredient Matching (Supabase RPC)

```
client.rpc('rx_match_medication_lines', { medication_lines: medicationLines })
```

**What goes in:**
```sql
medication_lines text[] = ARRAY[
  'AMOXICILLIN 500 MG CAPSULE',
  'Spiriva Respimat 2.5mcg/puff 60puff/bot (tiotropium)',
  'PREDNISOLONE 5 MG TAB',
  'UNKNOWN_DRUG_XYZ'
]
```

**What the RPC does (3-pass algorithm):**

| Pass | Method | How it works | Confidence |
|------|--------|-------------|------------|
| 1 | `canonical_exact` | `rx_normalize_text(input)` matches `rx_ingredient_concepts.canonical_name_normalized` directly | 0.95 |
| 2 | `alias_exact` | `rx_normalize_text(input)` matches `rx_name_variants.normalized_text` (target_type=ingredient), joined to `rx_ingredient_concepts` | 0.90 |
| 3 | `paren_alias_exact` | Extracts parenthesized text from input (e.g., `(tiotropium)`) → normalizes → matches variants/aliases | 0.85 |

Each pass requires `candidate_count = 1` for a match. If multiple candidates exist for the same input (ambiguous), the line is `unmatched`.

**What comes back:**
```json
[
  {
    "input_index": 0,
    "input_text": "AMOXICILLIN 500 MG CAPSULE",
    "normalized_text": "AMOXICILLIN 500 MG CAPSULE",
    "match_status": "matched",
    "ingredient_id": "a1b2c3d4-...",
    "ingredient_canonical_name": "Amoxicillin",
    "match_method": "canonical_exact",
    "confidence": 0.95
  },
  {
    "input_index": 1,
    "input_text": "Spiriva Respimat 2.5mcg/puff 60puff/bot (tiotropium)",
    "normalized_text": "SPIRIVA RESPIMAT 25MCG PUFF 60PUFF BOT TIOTROPIUM",
    "match_status": "matched",
    "ingredient_id": "e5f6g7h8-...",
    "ingredient_canonical_name": "Tiotropium",
    "match_method": "paren_alias_exact",
    "confidence": 0.85
  },
  {
    "input_index": 2,
    "input_text": "PREDNISOLONE 5 MG TAB",
    "normalized_text": "PREDNISOLONE 5 MG TAB",
    "match_status": "matched",
    "ingredient_id": "i9j0k1l2-...",
    "ingredient_canonical_name": "Prednisolone",
    "match_method": "canonical_exact",
    "confidence": 0.95
  },
  {
    "input_index": 3,
    "input_text": "UNKNOWN_DRUG_XYZ",
    "normalized_text": "UNKNOWN DRUG XYZ",
    "match_status": "unmatched",
    "ingredient_id": null,
    "ingredient_canonical_name": null,
    "match_method": null,
    "confidence": null
  }
]
```

### Step 5 — Brand Matching (Supabase RPC)

```
client.rpc('rx_match_brand_lines', { brand_lines: medicationLines })
```
**Same input as Step 4.** Runs a separate 2-pass algorithm against product data:

| Pass | Method | How it works | Confidence |
|------|--------|-------------|------------|
| 1 | `product_exact` | `rx_normalize_text(rx_strip_dosage_tail(input))` matches product `name_en` or `name_zh` directly | 0.95 |
| 2 | `alias_exact` | Normalized input matches `rx_name_variants.normalized_text` (target_type=product), joined to `rx_product_enriched_v` | 0.90 |

`rx_strip_dosage_tail()` strips trailing dosage info (e.g., "5 MG" from "Amoxicillin 5 MG") and quantity text (e.g., "總量28顆") to increase match rates.

Brand matching is **non-critical** — wrapped in try/catch, failures are silently ignored.

### Step 6 — Building DetectedItem[] from RPC Results

```
mapMedicationMatchesToDetectedItems(medicationLines, matchRows)
```

Merges RPC results with original medication lines by `input_index`:

```typescript
detectedItems = [
  {
    confidence: 0.95,
    display_name: "AMOXICILLIN 500 MG CAPSULE",
    ingredient_id: "a1b2c3d4-...",
    match_method: "canonical_exact",
    match_status: "matched",
    nhi_code: null,
    note: null,
    raw_text: "AMOXICILLIN 500 MG CAPSULE",
    source: "ocr_line"
  },
  {
    confidence: null,
    display_name: "UNKNOWN_DRUG_XYZ",
    ingredient_id: null,
    match_method: null,
    match_status: "unmatched",
    nhi_code: null,
    note: null,
    raw_text: "UNKNOWN_DRUG_XYZ",
    source: "ocr_line"
  }
]

ingredientIds = ["a1b2c3d4-...", "e5f6g7h8-...", "i9j0k1l2-..."]
// Only matched → unmatched lines excluded
```

### Step 7 — Persisting to Supabase

```
client.from('rx_cases').insert({
  case_type: input.caseType,
  detected_items: detectedItems,           // JSONB array
  ingredient_ids: uniqueIngredientIds,      // uuid[]
  ocr_raw_text: input.ocrRawText,
  ocr_sections: {                           // JSONB object
    medication_lines: [...],
    instruction_lines: [...],
    ...,
    case_fields: extractCaseFields(...),   // from structuredCaseExtractor.ts!
    remote_model: ...
  },
  photo_paths: [],
  share_to_all_care_teams: true,
  user_id: userId,
})
```

### Step 8 — DDI Screening (Post-Load)

Triggered by `CasePageScreen` after loading the case:
```
getCaseDdiByIngredients(caseRecord.ingredientIds)
  → validates IDs against rx_ingredient_concepts
  → calls rx_get_ddi_for_ingredients(validIngredientIds)
  → returns CaseDdiResult with pairwise interactions
```

---

## 3. Data Shape at Each Stage

```
STAGE 1: Raw OCR Elements
┌─────────────────────────────────────────────┐
│ RemoteOcrElement[]                           │
│ [{ type:"text", text:"AMOXICILLIN 500 MG",  │
│    bbox:[120,42,300,58], confidence:0.98 }] │
└─────────────────────────────────────────────┘
                    ↓ mapRemoteToOcrResult()

STAGE 2: Structured OCR Result
┌─────────────────────────────────────────────┐
│ OcrResult {                                  │
│   text: "AMOXICILLIN 500 MG\n...",          │
│   blocks: OcrBlock[],                        │
│   modelData: RemoteOcrResult                 │
│ }                                            │
└─────────────────────────────────────────────┘
                    ↓ mapOcrSections()

STAGE 3: Sectioned OCR
┌─────────────────────────────────────────────┐
│ SectionedOcr {                               │
│   sections: {                                │
│     medication: {                             │
│       lines: OcrLine[],  ← WITH bboxes      │
│       texts: string[]     ← text only        │
│     }                                        │
│   }                                          │
│ }                                            │
└─────────────────────────────────────────────┘
                    ↓ getMedicationCandidateLines()

STAGE 4: Candidate Lines
┌─────────────────────────────────────────────┐
│ medicationLines: string[]                    │
│ ["AMOXICILLIN 500 MG CAPSULE", ...]          │
│                                              │
│ Priority order:                               │
│  1. groupedMedicationItems (bbox-aware)      │
│  2. section.texts (string array)             │
│  3. extractDetectedItems (heuristic fallback)│
└─────────────────────────────────────────────┘
                    ↓ rx_match_medication_lines RPC

STAGE 5: Matched Ingredients
┌─────────────────────────────────────────────┐
│ RxMedicationLineMatchRow[]                   │
│ [{ input_index, match_status,                │
│    ingredient_id, canonical_name,            │
│    match_method, confidence }]               │
└─────────────────────────────────────────────┘
                    ↓ mapMedicationMatchesToDetectedItems()

STAGE 6: Final Detected Items + Ingredient IDs
┌─────────────────────────────────────────────┐
│ detectedItems: DetectedItem[]                │
│ ingredientIds: string[] (only matched)       │
└─────────────────────────────────────────────┘
                    ↓ INSERT INTO rx_cases

STAGE 7: Stored in Supabase
┌─────────────────────────────────────────────┐
│ rx_cases row                                 │
│   detected_items: JSONB                      │
│   ingredient_ids: uuid[]                     │
│   ocr_sections: JSONB (incl. case_fields)    │
│   ocr_raw_text: text                         │
└─────────────────────────────────────────────┘
```

---

## 4. Dependency Analysis: What Depends on What

### Dependency: `structuredCaseExtractor.ts` → `CaseFields`

**Consumers of `extractCaseFields()`:**

| Consumer | How it uses the output | Display Only? | Would break if removed? |
|----------|----------------------|---------------|------------------------|
| `buildStoredOcrSections()` in `api/case.ts` | Calls `extractCaseFields(ocrRawText, sectionedOcr)` to build `OcrSections.caseFields` | ✅ Display-only metadata | ✅ Would break — `OcrSections.caseFields` would be `undefined`. The display would show empty fields but NOT crash. |
| `CasePageScreen.tsx` → `renderCaseSummary()` | Reads `caseFields.patientName`, `caseFields.dispensingDate`, `caseFields.pharmacistName`, etc. | ✅ Display only | ❌ Would NOT crash — fields shown conditionally (`if (fields.xxx)`), so they'd simply not appear. |
| `CasePageScreen.tsx` → `renderDetectedItemsSection()` | Reads `detectedItems` from `CaseRecord` (NOT from CaseFields) | ✅ Display only | ❌ No dependency on CaseFields for med display |

**Key insight:** `extractCaseFields()` and `structuredCaseExtractor.ts` are **display metadata only**. They have **zero impact** on the medicine matching pipeline. The medication candidate lines for RPC matching come from `getMedicationCandidateLines()` which reads `sectionedOcr.sections.medication` — not from `CaseFields`.

### Dependency: `sectionMapper.ts` → `SectionedOcr`

**Consumers of `mapOcrSections()` / `SectionedOcr`:**

| Consumer | How it uses the output | Display Only? | Would break if removed? |
|----------|----------------------|---------------|------------------------|
| `getMedicationCandidateLines()` → Priority 1 & 2 | Reads `sections.medication.lines` or `sections.medication.texts` to produce candidate lines for RPC matching | ❌ **Critical for medicine matching** | ✅ Would break — medication detection depends on sectioned OCR. Without it, falls through to Priority 3 (`extractDetectedItems` from raw text). |
| `buildStoredOcrSections()` | Passes section lines (`medicationLines`, `instructionLines`, etc.) + `caseFields` + `modelData` to DB | ✅ Display + persistence | ❌ Would NOT break matching — these lines are for display, not for RPC matching. |
| `CaseDraftScreen.tsx` | Passes `sectionedOcr` to `createCase()` | ❌ **Input to pipeline** | ✅ Would break — `createCase` needs either `sectionedOcr` or `ocrRawText`. |
| `extractCaseFields()` | Uses `sectionedOcr` sections for directions/indications/warnings/sideEffects | ✅ Display only | ❌ Function has fallback: when `sectionedOcr` is missing, it extracts from raw text patterns. |

### Dependency: `groupMedicationLines.ts` → `GroupedItem[]`

**Consumers of `analyzeMedicationLineGrouping()` / `groupMedicationLinesIntoItems()`:**

| Consumer | How it uses the output | Display Only? | Would break if removed? |
|----------|----------------------|---------------|------------------------|
| `getMedicationCandidateLines()` → Priority 1 | Groups bbox-aware lines into coherent medication items → `string[]` for RPC | ❌ **Best matching path** | ❌ Would NOT break — falls back to Priority 2 (texts array) or Priority 3 (`extractDetectedItems`). Quality would degrade. |
| `extractDetectedItems()` → `getCandidateLines()` | Uses `groupMedicationLinesIntoItems()` on section lines when available | ❌ **Best extraction path** | ❌ Would NOT break — falls back to `mergeMedicationCandidates()` (regex-based). |

### Dependency: `ocrRawText` (string from OCR)

**Consumers of `ocrRawText`:**

| Consumer | How it uses the output | Display Only? | Would break if changed? |
|----------|----------------------|---------------|------------------------|
| `extractDetectedItems()` → Priority 3 fallback | Splits by `\n`, applies heuristics | ❌ **Last-resort matching** | Depends on format: split by `\n`. If raw text format changes (e.g., no newlines, different structure), this fallback would degrade. |
| `buildStoredOcrSections()` → `extractCaseFields()` | Regex-based field extraction from raw text | ✅ Display metadata | Depends on specific Chinese regex patterns (e.g., `姓名\s*[:：]\s*`). If format changes, fields would be empty but system wouldn't crash. |
| `CasePageScreen.tsx` | Displays raw OCR text for debugging | ✅ Display only | ❌ No impact on functionality |
| `CaseDraftScreen.tsx` | Passes raw text to `createCase()` | ✅ Input | ❌ Passed as-is to API |

### Dependency: `DetectedItem[]`

**Consumers of `DetectedItem[]`:**

| Consumer | How it uses the output | Display Only? |
|----------|----------------------|---------------|
| `createCase()` | Inserts into `rx_cases.detected_items` JSONB | Persistence |
| `getCase()` | Reads from DB, maps to `DetectedItem[]` | Data loading |
| `CasePageScreen.tsx` → `groupDetectedItemsForDisplay()` | Groups by `ingredientId` for matched/unmatched/other cards | Display only |
| `getCaseDdiByIngredients()` | Reads `ingredientIds` (separate column, NOT from DetectedItems) | DDI screening |

**Note:** DDI screening uses `ingredient_ids` (a separate `uuid[]` column), NOT `detected_items` JSONB. The two are populated together in `createCase()` but stored and read independently.

---

## 5. Tight Coupling Analysis

### Between `structuredCaseExtractor.ts` and Medicine Matching

```
structuredCaseExtractor.ts ← NO COUPLING → medicine matching pipeline
```

**Zero coupling.** The medicine matching pipeline (`getMedicationCandidateLines` → `rx_match_medication_lines` RPC) depends on:
- `sectionedOcr.sections.medication.lines/texts` (from `sectionMapper.ts`)
- `ocrRawText` (raw OCR output string)
- Neither of these comes from `structuredCaseExtractor.ts`

`extractCaseFields()` is called by `buildStoredOcrSections()` and its output (`CaseFields`) is stored in `ocr_sections.case_fields` for **display only**. Removing `structuredCaseExtractor.ts` would empty the display fields but wouldn't affect medication detection, ingredient matching, or DDI screening at all.

### Between `sectionMapper.ts` and Medicine Matching

```
sectionMapper.ts ← STRONG COUPLING → medicine matching pipeline
```

The medication candidate line extraction (`getMedicationCandidateLines`) depends **strongly** on `sectionMapper.ts`:

1. **Priority 1** (`analyzeMedicationLineGrouping`): Needs `sectionedOcr.sections.medication.lines` with bbox data
2. **Priority 2** (texts array): Needs `sectionedOcr.sections.medication.texts`
3. **Priority 3** (`extractDetectedItems` fallback): Needs `ocrRawText` only — but quality is lower

If `sectionMapper.ts` were removed, the pipeline would always fall through to Priority 3 — heuristic extraction from raw text, which is significantly less reliable (no bbox-aware grouping, no section-based filtering).

### Between `ocrRawText` Format and Medicine Matching

```
ocrRawText format ← MODERATE COUPLING → Priority 3 fallback matching
```

Only Priority 3 (`extractDetectedItems`) depends on `ocrRawText` format:
- Expects lines separated by `\n`
- Applies regex heuristics (dosage, form, boilerplate detection)
- If format changed (e.g., single string, no line breaks), the fallback would degrade

Priorities 1 & 2 work from `SectionedOcr` which has already processed the text — they don't touch `ocrRawText` at all.

---

## 6. Complete `createCase()` Flow (Annotated)

```
createCase(input)
│
├─[1] requireCurrentUserId(client)
│     → Input: nothing (uses Supabase auth)
│     → Output: userId (string)
│
├─[2] medicationLines = getMedicationCandidateLines(input)
│     → Input: input.sectionedOcr (SectionedOcr), input.ocrRawText (string)
│     → Output: string[] (medication candidate lines for RPC)
│     → Uses: sectionMapper output (SectionedOcr) ✓ CRITICAL
│     → NOT using: structuredCaseExtractor ✗
│
├─[3] storedOcrSections = buildStoredOcrSections(input)
│     → Input: input.sectionedOcr, input.ocrRawText
│     → Output: OcrSections (all line arrays + caseFields + remoteModel)
│     → Uses: extractCaseFields(ocrRawText, sectionedOcr) ← structuredCaseExtractor ✓
│     → Note: This call is for DISPLAY ONLY. Does not affect matching.
│     → Note: Called TWICE (second time at step 7 with brand data appended)
│
├─[4] ingredientResult = client.rpc('rx_match_medication_lines', { medication_lines: medicationLines })
│     → Input: string[] from step 2
│     → Output: RxMedicationLineMatchRow[] (match_status, ingredient_id, confidence, etc.)
│     → Uses: Supabase RPC, rx_ingredient_concepts, rx_name_variants
│
├─[5] brandResult = client.rpc('rx_match_brand_lines', { brand_lines: medicationLines })
│     → Input: string[] from step 2 (same as step 4)
│     → Output: RxBrandLineMatchRow[] (product_id, nhi_code, display_name)
│     → Non-critical: wrapped in try/catch
│
├─[6] finalOcrSections = buildStoredOcrSections(input, brandNames, brandMatches)
│     → Same as step 3, but with brand data appended to caseFields
│     → Uses: extractCaseFields ← structuredCaseExtractor ✓ (display only)
│
├─[7] { detectedItems, ingredientIds } = mapMedicationMatchesToDetectedItems(medicationLines, matchRows)
│     → Input: string[] from step 2, RPC rows from step 4
│     → Output: detectedItems (DB-ready objects), ingredientIds (string[])
│
├─[8] INSERT INTO rx_cases
│     → stored: detected_items (JSONB), ingredient_ids (uuid[]), ocr_sections (JSONB), ocr_raw_text, photo_paths, user_id
│
├─[9] Upload photos to Supabase Storage
│     → createUploadImage() + createThumbnailImage() → resize + compress
│     → upload to rx-case-photos bucket
│
├─[10] UPDATE rx_cases SET photo_paths = uploadedPhotoPaths
│
└─[11] return { caseId }
```

### What Steps Depend on `structuredCaseExtractor.ts` Specifically:

| Step | Uses `extractCaseFields()`? | Impact if removed |
|------|---------------------------|-------------------|
| 3 (`buildStoredOcrSections`) | ✅ Yes | `caseFields` would be null — display empty but no crash |
| 6 (`buildStoredOcrSections` with brands) | ✅ Yes | Same as above |
| All other steps | ❌ No | No impact on matching, detection, or DDI |

---

## 7. What Would Break If `structuredCaseExtractor.ts` Was Replaced

### Would NOT break:
- ✅ Medication candidate line extraction (`getMedicationCandidateLines`)
- ✅ Ingredient matching (`rx_match_medication_lines` RPC)
- ✅ Brand matching (`rx_match_brand_lines` RPC)
- ✅ `DetectedItem[]` construction (`mapMedicationMatchesToDetectedItems`)
- ✅ `ingredient_ids` extraction and storage
- ✅ DDI screening (`getCaseDdiByIngredients`)
- ✅ Photo upload and storage
- ✅ Case creation and retrieval

### Would break (display only):
- ⚠️ `CasePageScreen` would show empty patient info, pharmacy info, indications, warnings, side effects
- ⚠️ `ocr_sections.case_fields` would be null in the database
- ⚠️ The "Case Summary" card on the Case Page would be empty/hidden

### Migration path:
The medicine matching pipeline is **fully decoupled** from `structuredCaseExtractor.ts`. Replacing it with a Groq LLM call in FastAPI would require:
1. Replacing the `extractCaseFields()` call with a new function that parses the LLM response
2. Keeping **all other code unchanged** — `getMedicationCandidateLines`, RPC calls, detected item construction, and DB inserts would remain identical
3. The only contract change is in `CaseFields` shape — the LLM must produce the same fields

---

## 8. Summary

| Aspect | Finding |
|--------|---------|
| **Medicine matching entry point** | `getMedicationCandidateLines()` in `api/case.ts` |
| **Input to matching** | `sectionedOcr.sections.medication` (from `sectionMapper.ts`) — NOT from `structuredCaseExtractor.ts` |
| **Matching is done by** | Supabase RPCs (`rx_match_medication_lines`, `rx_match_brand_lines`) running SQL against `rx_ingredient_concepts` + `rx_name_variants` |
| **`DetectedItem[]`** | Built by `mapMedicationMatchesToDetectedItems()` from RPC results + original candidate lines |
| **`ingredient_ids`** | Extracted as a Set of matched ingredient_id UUIDs, stored in separate column |
| **DDI** | Uses `ingredient_ids` column (not `detected_items` JSONB), called post-load by `CasePageScreen` |
| **`structuredCaseExtractor.ts` role** | Produces `CaseFields` for **display metadata only** — patient name, pharmacy, dates, indications/warnings text blocks |
| **Coupling to med matching** | **None.** `extractCaseFields()` is never called by any function in the medication detection, matching, or DDI pipeline |
| **Safe to replace** | ✅ Yes — `structuredCaseExtractor.ts` can be replaced with Groq LLM without affecting medicine matching at all |
