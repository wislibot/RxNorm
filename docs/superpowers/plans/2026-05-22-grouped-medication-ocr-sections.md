# Grouped Medication OCR Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grouped medication helper logic, richer framed OCR section output, and mobile persistence of `ocr_sections` so case creation uses grouped medication items and stores section geometry.

**Architecture:** Keep the existing anchor-based OCR section mapper, but change its output shape so each section includes framed OCR lines plus derived text lines. Add a dedicated medication grouping helper that merges adjacent medication name/detail lines deterministically, then use those grouped items as the RPC input for case creation while persisting section data into `rx_cases.ocr_sections`.

**Tech Stack:** TypeScript, React Native, Jest, Supabase client

---

### Task 1: Rich OCR Section Output

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\sectionMapper.ts`
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\__tests__\sectionMapper.test.ts`

- [ ] Write failing tests that assert section outputs include framed lines and derived text arrays
- [ ] Implement a section entry shape with `lines` and `texts` for every section
- [ ] Keep current anchor detection and region assignment behavior intact while returning richer output
- [ ] Run the focused section mapper test slice

### Task 2: Grouped Medication Helper

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\detectedItems\extractDetectedItems.ts`
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\detectedItems\__tests__\extractDetectedItems.test.ts`

- [ ] Write failing tests for medication grouping from framed section lines and plain text fallback
- [ ] Extract deterministic grouping logic into a reusable helper for medication candidates
- [ ] Keep detected item extraction behavior compatible with the new `SectionedOcr` shape
- [ ] Run the focused detected-items test slice

### Task 3: Case Persistence And RPC Input

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\case.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\types\case.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\scan\CaseDraftScreen.tsx`
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\__tests__\case.test.ts`
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\scan\__tests__\caseDraftScreen.test.tsx`

- [ ] Write failing tests that assert grouped medication RPC input and `ocr_sections` insert payload persistence
- [ ] Update create-case wiring to send grouped medication items to `rx_match_medication_lines`
- [ ] Persist `ocr_sections` in the `rx_cases` insert payload using the richer section output
- [ ] Run the focused API and screen test slices

### Task 4: Validation

**Files:**
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\__tests__\sectionMapper.test.ts`
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\detectedItems\__tests__\extractDetectedItems.test.ts`
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\__tests__\case.test.ts`
- Test: `e:\TRAE\Projects\RxNorm\apps\mobile\src\scan\__tests__\caseDraftScreen.test.tsx`

- [ ] Run the focused Jest slices covering the changed OCR mapper, grouping helper, case API, and draft screen wiring
- [ ] Check diagnostics for edited files and resolve any introduced type or lint issues
