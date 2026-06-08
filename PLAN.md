# Plan: Fix Medication Extraction Pipeline — Taiwan Prescription Headers + LLM `other` Array

## Context

Two bugs in the mobile app's medication extraction pipeline:

1. **Taiwanese prescription headers not detected**: The `detectAnchors()` function in `sectionMapper.ts:107` uses `text.startsWith(normalizedKw)`, which fails when OCR reads headers like "N處方" (normalizes to "n處方") or lines have leading whitespace. Taiwanese prescriptions use "處方" (prescription) and "次量" (dose) instead of "藥名" (medication name). Without detection, all lines go to `unassigned` → aggressive `extractDetectedItems` fallback.

2. **Groq LLM `other` array unused**: The Groq prompt (`groq_extractor.py:205`) returns `"other": string[]` — unsigned/unclassifiable text. The Python server returns it, but `RemoteCaseFields` type in `types.ts` doesn't declare it, and `getMedicationCandidateLines()` never uses it.

## Changes

### 1. `apps/mobile/src/ocr/types.ts` — Add `other` to `RemoteCaseFields`

Add `other?: string[]` to the type (line 37). Optional to preserve existing test fixture compatibility.

### 2. `apps/mobile/src/ocr/sectionMapper.ts` — Fix anchor detection + add Taiwanese keywords

**ANCHORS (line 52-62):** Add "處方" → `medication`, "次量" → `instruction`.

**`detectAnchors` (line 94-114):** 
- Add `text.trimStart()` before keyword comparison
- Add `includes()` fallback with length guard for prefix artifacts like "N處方"
- Keep existing `startsWith` logic intact

### 3. `apps/mobile/src/api/case.ts` — Use `other` array as medication fallback

In `getMedicationCandidateLines()` (line 142-147), insert `other` fallback between raw section texts and `extractDetectedItems`:
- Access via `input.sectionedOcr?.modelData?.case_fields?.other`
- Filter: non-empty, length >= 3, trimmed
- Only used when grouped items AND raw section texts are both empty

### 4. `apps/mobile/src/ocr/__tests__/sectionMapper.test.ts` — Add 3 tests

- Taiwanese "處方" header → medication section
- "N處方" prefix artifact → medication section  
- Leading whitespace on anchor → still detected

### 5. `apps/mobile/src/api/__tests__/case.test.ts` — Add 1 test

- `other` array items used as medication candidates when section is empty
- Short items (< 3 chars) filtered out

## Verification

```bash
cd apps/mobile && npx jest --testPathPattern=sectionMapper -v
cd apps/mobile && npx jest --testPathPattern=case.test -v
cd apps/mobile && npx tsc --noEmit
```

## Risk

- `includes()` fallback has length guard (`trimmedText.length <= normalizedKw.length + 6`) to prevent false positives on long lines
- `other` fallback only activates when both grouped items AND raw section texts are empty (degraded path)
- Unmatched noise from `other` is naturally suppressed by `mapMedicationMatchesToDetectedItems` dedup logic
