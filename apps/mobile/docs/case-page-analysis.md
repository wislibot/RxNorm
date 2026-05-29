# Case Page — Full Analysis

> Generated: 2026-05-27  
> Scope: Analysis only — no code changes

---

## 1. File Inventory

### Core Case Page (`src/case/`)

| File | Purpose | Key Exports |
|------|---------|-------------|
| `CasePageScreen.tsx` | **The main Case Page** — fetches data, renders all sections. 498 lines, ~50% of which is `StyleSheet.create`. | `CasePageScreen` (component), helper functions: `groupDetectedItemsForDisplay`, `looksMedicationRelated`, `isMetaNoise`, `filterInstructionLines`, `renderGroupCard`, `renderCaseSummary`, `renderDetectedItemsSection`, `renderInteractionCard` |
| `CaseHistoryScreen.tsx` | Lists all previous cases. Each row is a `Pressable` → navigates to `CasePage` with `caseId`. | `CaseHistoryScreen` |
| `navigationTypes.ts` | Navigation parameter types for case stack. | `CasePageParams` (`{ caseId: string }`), `MyMedsStackParamList` |

### Type Definitions

| File | Purpose |
|------|---------|
| `types/case.ts` | `CaseRecord` (full case data), `OcrSections`, `DetectedItem`, `CaseSummary`, `CreateCaseInput` |
| `types/caseFields.ts` | `CaseFields` (14 nullable fields: patientName, patientSex, quantity, directions, indications, warnings, sideEffects, pharmacyName, pharmacyAddress, pharmacistName, physicianName, dispensingDate, brandNames, brandMatches) |

### API Layer (`src/api/`)

| File | Purpose |
|------|---------|
| `case.ts` | `getCase(caseId)` — loads `RxCaseRow` from Supabase, builds signed photo URLs, maps to `CaseRecord`. `createCase()` — the inverse: runs OCR → extracts fields → persists everything |
| `ddi.ts` | `getCaseDdiByIngredients()` — fetches DDI interactions for matched ingredient IDs |

### OCR Processing (consumed by Case Page)

| File | Purpose |
|------|---------|
| `ocr/normalizeOcrEnglish.ts` | `normalizeOcrEnglishSpacing()` — repairs English OCR artifacts (e.g., "Precaut ions" → "Precautions"). Called by the `norm()` helper in CasePageScreen on every display string. |
| `ocr/structuredCaseExtractor.ts` | `extractCaseFields(rawText, sectionedOcr?)` — produces the `CaseFields` object displayed on the Case Page |

### Navigation (`src/navigation/`)

| File | Purpose |
|------|---------|
| `PatientTabs.tsx` | Registers `CasePageScreen` in TWO stacks: `ScanStack` (line 52, title: `casePageTitle` from i18n) and `MyMedsStack` (line 73). Both use `caseId` param. |

### Entry Points (Screens that navigate to CasePage)

| File | How it navigates |
|------|------------------|
| `scan/CaseDraftScreen.tsx` (line 85) | After `createCase()` returns `{ caseId }`, calls `navigation.navigate('CasePage', { caseId })` |
| `case/CaseHistoryScreen.tsx` (line 57) | On pressing a list item: `navigation.navigate('CasePage', { caseId: item.caseId })` |

---

## 2. How Each Field Is Currently Displayed

The Case Page renders every section inside one giant `ScrollView` with a series of `<View style={styles.card}>` blocks. The rendering order is **hardcoded** in the JSX at lines 436-493.

### Section order (hardcoded in JSX):

```
1. Title card (title + createdAt)
2. Photos card
3. Auto-share status card
4. renderCaseSummary() card (fields below)
5. OCR raw text card
6. Instruction lines card
7. renderDetectedItemsSection() cards
8. DDI interactions card
```

### Field-by-field breakdown within `renderCaseSummary()`:

| # | Field | Data Source | Rendering Style | i18n Label Key | i18n EN Label | Condition |
|---|-------|------------|-----------------|----------------|---------------|-----------|
| 1 | **Patient Name** | `fields.patientName` | `fieldRow` (label: 80px minWidth + value) | `caseSummaryPatientName` | "Patient Name" | Truthy check |
| 2 | **Patient Sex** | `fields.patientSex` | `fieldRow` | `caseSummarySexLabel` | "Sex" | Truthy check, translated M/F |
| 3 | **Quantity** | `fields.quantity` | `fieldRow` | `caseSummaryQuantity` | "Quantity" | Truthy check |
| 4 | **Dispensing Date** | `fields.dispensingDate` | `fieldRow` | `caseSummaryDispensingDateLabel` | "Dispensing Date" | Truthy check |
| 5 | **Indications** | `fields.indications[]` | `fieldBlock` (multi-line) | `caseSummaryIndications` | "Indications" | Array.length > 0 |
| 6 | **Warnings** | `fields.warnings[]` | `fieldBlock` (multi-line) | `caseSummaryWarnings` | "Warnings & Precautions" | Array.length > 0 |
| 7 | **Side Effects** | `fields.sideEffects[]` | `fieldBlock` (multi-line) | `caseSummarySideEffects` | "Side Effects" | Array.length > 0 |
| 8 | **Brand Names** | `fields.brandNames[]` | `fieldBlock` (multi-line) | `caseSummaryBrandNameLabel` | "Brand Name" | Array.length > 0 |
| 9 | **Pharmacy Name** | `fields.pharmacyName` | `fieldRow` | `caseSummaryPharmacyName` | "Pharmacy" | Truthy check |
| 10 | **Pharmacy Address** | `fields.pharmacyAddress` | `fieldRow` | `caseSummaryPharmacyAddress` | "Pharmacy Address" | Truthy check |
| 11 | **Pharmacist Name** | `fields.pharmacistName` | `fieldRow` | `caseSummaryPharmacistLabel` | "Pharmacist" | Truthy check |

### The `norm()` helper

Applied to multi-line and English-heavy values:

```typescript
const norm = (text: string) => normalizeOcrEnglishSpacing(text);
```

This repairs split words like "Warnings & Precaut ions" → "Warnings & Precautions" before display.  
Applied to: brand names, pharmacy name, indications, warnings, side effects, and medication group titles/lines.

### Fields in `CaseFields` that are **NOT displayed** in the UI:

| Missing Field | Where It Lives | Extracted By | Current Status |
|---------------|---------------|--------------|----------------|
| **`physicianName`** | `caseFields.ts` | `extractPhysicianName()` → `extractCaseFields()` → persisted in DB | ❌ Not rendered anywhere in CasePageScreen. No i18n key exists for it. |
| **`directions`** | `caseFields.ts` | `extractCaseFields()` → from `sectionedOcr.sections.instruction.texts` | ❌ Not rendered. There IS a separate "Instruction lines" card (line 469) that shows `ocrSections.instructionLines`, but `fields.directions` (a single string) is not used. |
| **`brandMatches`** | `caseFields.ts` | RPC `rx_match_brand_lines` | ❌ Not rendered. Only `brandNames` (string array) is shown, not matched brands with product IDs. |

---

## 3. Hardcoded / Inflexible Aspects

### Hardcoded field order

The order of the 11 fields inside `renderCaseSummary()` is **fixed** in the JSX at lines 324-409. There is no data-driven field list or declarative config. Changing the order requires editing the JSX directly.

### Hardcoded labels

All section titles and field labels are **stored in i18n JSON** (61 keys total for `casePage*` and `caseSummary*`), which is the i18n-idiomatic approach. While technically "hardcoded" in JSON files, this is the standard pattern and supports localization.

### Hardcoded layout

The entire page is one monolithic `ScrollView` with inline card rendering. There is:
- No page/pagination support
- No collapsible sections
- No separate components for each section
- All rendering logic inline (not extracted into sub-components)
- The `renderCaseSummary()` function renders all 11 fields in a single card — so if any ONE field is present, the entire "Case Summary" card appears

### Hardcoded styling

All 200+ lines of `StyleSheet.create` are inline at the bottom of the file (lines 497-708). There are no shared section card components that could be reused.

### Missing fields (extracted but invisible)

As noted above: `physicianName`, `directions`, and `brandMatches` are extracted and stored but never shown.

### Hardcoded conditionals

Every field has its own `if (fields.xxx) { ... }` block. There is no centralized "which fields to show" logic.

---

## 4. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  SUPABASE DB (rx_cases table)                                    │
│  Column: ocr_sections (JSONB)                                    │
│  {                                                               │
│    medication_lines: [...],                                       │
│    instruction_lines: [...],                                      │
│    indications_lines: [...],                                      │
│    warnings_lines: [...],                                         │
│    side_effects_lines: [...],                                     │
│    dispensing_date_lines: [...],                                  │
│    quantity_lines: [...],                                         │
│    pharmacist_lines: [...],                                       │
│    case_fields: {                                                 │
│      patientName, patientSex, quantity, directions,              │
│      indications[], warnings[], sideEffects[],                    │
│      pharmacyName, pharmacyAddress, pharmacistName,              │
│      physicianName, dispensingDate, brandNames[], brandMatches[] │
│    },                                                             │
│    remote_model: { engine, version, pages[...] }                 │
│  }                                                               │
│  detected_items: [{ display_name, match_status, ... }]           │
│  ingredient_ids: [...]                                           │
│  photo_paths: [...]                                              │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ getCase(caseId)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  CaseRecord (TypeScript)                                          │
│  {                                                                │
│    caseId, caseType, createdAt, updatedAt,                       │
│    ocrRawText: string,                                            │
│    ocrSections: OcrSections (all lines arrays + caseFields),     │
│    detectedItems: DetectedItem[],                                 │
│    photoPaths: string[],                                          │
│    photoUrls: string[] (signed URLs from Supabase Storage),      │
│    thumbUrls: string[],                                           │
│    ingredientIds: string[],                                       │
│    shareToAllCareTeams: boolean                                   │
│  }                                                                │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ setCaseRecord(loadedCase)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  CasePageScreen Component State                                   │
│                                                                   │
│  useState<CaseRecord | null>(null)                                │
│                                                                   │
│  useMemo → medicationGroups                                       │
│    = groupDetectedItemsForDisplay(caseRecord.detectedItems)      │
│    → MedicationGroup[] { title, matchStatus, confidence,        │
│                           items, lines }                          │
│                                                                   │
│  renderCaseSummary()                                              │
│    → reads caseRecord.ocrSections.caseFields                     │
│    → norm() applies normalizeOcrEnglishSpacing to each string    │
│    → renders each field with its i18n label                       │
│                                                                   │
│  filterInstructionLines()                                         │
│    → strips known section header lines from instructionLines     │
│    → joins with \n and renders as body text                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  RENDERED UI (single ScrollView)                                  │
│                                                                   │
│  Card 1: Title + timestamp                                        │
│  Card 2: Photo grid (photoUrls)                                   │
│  Card 3: Auto-share status                                        │
│  Card 4: Case Summary (patient name → ... → pharmacist name)     │
│  Card 5: OCR raw text (scrollable, 220px max)                     │
│  Card 6: Instruction lines (filtered, joined)                     │
│  Card 7: Detected Items (matched + unmatched + other groups)     │
│  Card 8: DDI interactions (severity badges + messages)            │
└─────────────────────────────────────────────────────────────────┘
```

### Transformations before rendering:

| Data | Transformation |
|------|---------------|
| `detectedItems[]` | `groupDetectedItemsForDisplay()` groups by ingredientId, splits matched/unmatched/other, applies `looksMedicationRelated()` and `isMetaNoise()` filters |
| `caseFields.*` | Each string passed through `norm()` = `normalizeOcrEnglishSpacing()` to repair English OCR splits |
| `instructionLines[]` | `filterInstructionLines()` removes known section header lines (e.g., "Indications", "用法") that leaked into the instruction section |
| `photoPaths[]` | Converted to signed URLs (24h expiry) via `buildSignedUrls()` in `getCase()` |
| `createdAt` | Formatted via `new Date(caseRecord.createdAt).toLocaleString()` |

---

## 5. Navigation to CasePageScreen

### Two entry paths:

**Path A — New case from scan:**
```
CaseDraftScreen
  → user taps "Create Case"
  → createCase({...}) → returns { caseId }
  → navigation.navigate('CasePage', { caseId })
```

**Path B — View from history:**
```
MyMedsScreen → CaseHistoryScreen
  → user taps a case row
  → navigation.navigate('CasePage', { caseId: item.caseId })
```

### Params:
```typescript
type CasePageParams = { caseId: string };
```

Only the `caseId` is passed — everything else is loaded fresh from the server via `getCase(caseId)` inside a `useEffect`. This means the Case Page always shows the latest server state, not stale in-memory data.

### Stack registration (PatientTabs.tsx):

The same `CasePageScreen` component is registered in **two** stack navigators:

```typescript
// ScanStack (line 52)
<ScanStack.Screen component={CasePageScreen} name="CasePage"
  options={{ title: t('casePageTitle') }} />

// MyMedsStack (line 73)
<MyMedsStack.Screen component={CasePageScreen} name="CasePage"
  options={{ title: t('casePageTitle') }} />
```

Both use the same title key: `t('casePageTitle')` → "藥物病例" (zh-TW) / "Medication case" (EN).

---

## 6. i18n Keys Reference

All 61 i18n keys used by the Case Page (`casePage*` and `caseSummary*`):

| Key | EN | zh-TW |
|-----|----|----|
| `casePageTitle` | Medication case | 藥物病例 |
| `casePageCreatedPlaceholder` | Created just now · placeholder timestamp | 剛剛建立 · 時間為暫時顯示 |
| `casePageLoading` | Loading your medication case... | 正在載入藥物病例... |
| `casePageLoadError` | We could not load this medication case. Please try again. | 目前無法載入這個藥物病例，請再試一次。 |
| `casePageAutoShareTitle` | Auto-share status | 自動分享狀態 |
| `casePageAutoShareDefaultOn` | Shared to all linked clinics by default. | 預設會分享給所有已連結診所。 |
| `casePageAutoShareDefaultOff` | Auto-share is turned off. | 自動分享目前已關閉。 |
| `casePageSharedToCount` | Currently shared to: {{count}} care teams | 目前已分享給：{{count}} 個照護團隊 |
| `casePageOcrSectionTitle` | OCR raw text | OCR 原始文字 |
| `casePageInstructionTitle` | Instruction | 用法 |
| `caseSummaryTitle` | Case Summary | 藥品案例摘要 |
| `caseSummaryPatientName` | Patient Name | 姓名 |
| `caseSummaryPatientSex` | Sex | 性別 |
| `caseSummarySexLabel` | Sex | 性別 |
| `caseSummarySexMale` | Male | 男 |
| `caseSummarySexFemale` | Female | 女 |
| `caseSummaryQuantity` | Quantity | 數量 |
| `caseSummaryDispensingDate` | Dispensing Date | 調劑日期 |
| `caseSummaryDispensingDateLabel` | Dispensing Date | 調劑日期 |
| `caseSummaryIndications` | Indications | 用途 |
| `caseSummaryWarnings` | Warnings & Precautions | 警語 |
| `caseSummarySideEffects` | Side Effects | 副作用 |
| `caseSummaryBrandNameLabel` | Brand Name | 商品名 |
| `caseSummaryPharmacyName` | Pharmacy | 藥局 |
| `caseSummaryPharmacyAddress` | Pharmacy Address | 地址 |
| `caseSummaryPharmacist` | Pharmacist | 藥師 |
| `caseSummaryPharmacistLabel` | Pharmacist | 藥師 |
| `casePageDetectedItemsTitle` | Detected items | 偵測項目 |
| `casePageOtherExtractedTitle` | Other extracted text | 其他擷取文字 |
| `casePageMatchStatus.matched` | Matched | 已比對 |
| `casePageMatchStatus.unmatched` | Unmatched | 未比對 |
| `casePageConfidenceLabel` | Confidence {{value}}% | 信心 {{value}}% |
| `casePageConfidencePending` | Pending review | 等待審查 |
| `casePageNhiCodeLabel` | NHI code: {{code}} | 健保代碼：{{code}} |
| `casePageDoctorNoteLabel` | Doctor note | 醫師備註 |
| `casePageDoctorNotePlaceholder` | No note yet. | 目前沒有備註。 |
| `casePageDdiTitle` | DDI section | 交互作用區塊 |
| `casePageDdiUncheckedWarning` | Some medicines could not be checked for interactions. | 有些藥物目前無法完成交互作用檢查。 |
| `casePageNoInteractions` | No interactions found among checked medicines. | 已檢查的藥物之間沒有發現交互作用。 |
| `casePageCoverageDisclaimerFallback` | DDI screening coverage is limited to medicines in the Taiwan curated dictionary... | 交互作用檢查僅涵蓋台灣整理後的藥物字典... |
| `casePageSeverity.major` | Major | 重大 |
| `casePageSeverity.moderate` | Moderate | 中度 |
| `casePageSeverity.minor` | Minor | 輕度 |

---

## 7. Summary

| Aspect | Current State |
|--------|--------------|
| **Section count** | 8 cards in flat ScrollView |
| **Rendered fields** | 11 of 14 CaseFields shown (physicianName, directions, brandMatches missing) |
| **Field order** | Hardcoded in JSX |
| **Styling** | 200+ lines of StyleSheet inline in the component |
| **Sub-components** | None — all logic inline in one file |
| **i18n** | 61 keys, English + zh-TW, all present |
| **Data loading** | Fresh from server on mount (not cached nav params) |
| **Medication display** | Deduplicated by ingredientId, grouped as matched/unmatched cards |
| **DDI** | Full severity badges + English messages (no Chinese translations) |
| **Pagination** | None — single monolith |
