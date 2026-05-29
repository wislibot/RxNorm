# OCR Grouping And Instruction Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group multi-line OCR medication text into complete detected-item blocks, persist OCR medication/instruction sections on cases, and add a DEV-only OCR debug screen for bounding-box verification.

**Architecture:** Extend the structured OCR path instead of changing the OCR engine. Keep section mapping as the source of medication/instruction regions, add a deterministic line-grouping helper over medication lines with frames, persist grouped item text and `ocr_sections` at case creation, then surface instruction lines and a DEV-only debug screen in the app.

**Tech Stack:** Expo, React Native, TypeScript, Supabase JS, Supabase Postgres migrations, Jest, `@react-native-ml-kit/text-recognition`, `expo-asset`

---

## File Map

- Create: `e:\TRAE\Projects\RxNorm\supabase\migrations\202605220002_add_ocr_sections_to_rx_cases.sql`
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\groupMedicationLines.ts`
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\__tests__\groupMedicationLines.test.ts`
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\src\dev\OcrDebugScreen.tsx`
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\assets\ocr_samples\medicine_bag_sample.png`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\types.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\sectionMapper.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\ocr.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\types\case.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\case.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\case\CasePageScreen.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\scan\CaseDraftScreen.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\scan\__tests__\caseDraftScreen.test.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\__tests__\case.test.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\case\__tests__\casePageScreen.test.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\settings\SettingsScreen.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\settings\__tests__\*.test.tsx` if the new DEV entry affects current settings tests
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\navigation\PatientTabs.tsx` or the settings stack file if the DEV screen needs a route
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\i18n\translations\en.json`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\i18n\translations\zh-TW.json`

### Task 1: Add OCR Sections DB Column

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\supabase\migrations\202605220002_add_ocr_sections_to_rx_cases.sql`

- [ ] **Step 1: Write the migration file**

```sql
alter table public.rx_cases
add column if not exists ocr_sections jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Verify SQL file is syntactically valid**

Run: no runtime command yet; inspect for only additive schema change  
Expected: single additive `alter table`, no RLS or trigger changes

- [ ] **Step 3: Apply the migration**

Run: Supabase migration apply for `e:\TRAE\Projects\RxNorm\supabase\migrations\202605220002_add_ocr_sections_to_rx_cases.sql`  
Expected: migration applies successfully

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202605220002_add_ocr_sections_to_rx_cases.sql
git commit -m "feat: add ocr sections to rx cases"
```

### Task 2: Add Failing Grouping Tests

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\__tests__\groupMedicationLines.test.ts`
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\groupMedicationLines.ts`

- [ ] **Step 1: Write the failing test for adjacent line grouping**

```ts
import { groupMedicationLinesIntoItems } from '../groupMedicationLines';
import type { OcrLine } from '../types';

test('merges vertically adjacent aligned medication lines into one grouped item', () => {
  const lines: OcrLine[] = [
    { text: 'Spiriva Respimat', frame: { x: 120, y: 40, width: 120, height: 16 } },
    { text: '2.5 mcg/puff 80 puff/bottle', frame: { x: 122, y: 58, width: 150, height: 16 } },
  ];

  expect(groupMedicationLinesIntoItems(lines)).toEqual([
    expect.objectContaining({
      text: 'Spiriva Respimat 2.5 mcg/puff 80 puff/bottle',
    }),
  ]);
});
```

- [ ] **Step 2: Add failing tests for no-merge conditions**

```ts
test('does not merge a header-like line into a medication group', () => {
  const lines: OcrLine[] = [
    { text: 'Spiriva Respimat', frame: { x: 120, y: 40, width: 120, height: 16 } },
    { text: '用法', frame: { x: 120, y: 58, width: 40, height: 16 } },
  ];

  expect(groupMedicationLinesIntoItems(lines)).toHaveLength(2);
});

test('does not merge lines from a different column', () => {
  const lines: OcrLine[] = [
    { text: 'Spiriva Respimat', frame: { x: 120, y: 40, width: 120, height: 16 } },
    { text: '2.5 mcg/puff', frame: { x: 180, y: 58, width: 100, height: 16 } },
  ];

  expect(groupMedicationLinesIntoItems(lines)).toHaveLength(2);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --runInBand src/ocr/__tests__/groupMedicationLines.test.ts`  
Expected: FAIL because `groupMedicationLinesIntoItems` does not exist yet

- [ ] **Step 4: Write minimal grouping implementation**

```ts
import type { OcrLine, OcrRect } from './types';

export type GroupedItem = {
  text: string;
  lines: OcrLine[];
  frame: OcrRect;
};

const COLUMN_ALIGNMENT_TOLERANCE = 20;
const DOSAGE_RE = /\b\d+(?:\.\d+)?\s*(mcg|mg|g|ml|iu|%)\b/i;
const CONTINUATION_RE = /\b(puff|puffs|bot|bottle)\b/i;
const HEADER_RE = /藥名|用法|用途|外觀|警語|副作用|領藥號|調劑日期|medication|instruction|indications|appearance|warnings|side effects|prescription|dispensing/i;
const QUANTIFIER_RE = /盒|瓶|錠|粒/;

function unionFrame(lines: OcrLine[]): OcrRect {
  const left = Math.min(...lines.map((line) => line.frame.x));
  const top = Math.min(...lines.map((line) => line.frame.y));
  const right = Math.max(...lines.map((line) => line.frame.x + line.frame.width));
  const bottom = Math.max(...lines.map((line) => line.frame.y + line.frame.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function isContinuation(line: OcrLine) {
  const text = line.text.trim();
  return (
    text.startsWith('(') ||
    DOSAGE_RE.test(text) ||
    CONTINUATION_RE.test(text) ||
    (text.length <= 10 && QUANTIFIER_RE.test(text))
  );
}

function isHeader(line: OcrLine) {
  return HEADER_RE.test(line.text);
}

export function groupMedicationLinesIntoItems(lines: OcrLine[]): GroupedItem[] {
  const sortedLines = [...lines].sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
  const groups: GroupedItem[] = [];

  for (const line of sortedLines) {
    const current = groups[groups.length - 1];
    if (!current || isHeader(line)) {
      groups.push({ text: line.text.trim(), lines: [line], frame: unionFrame([line]) });
      continue;
    }

    const gap = line.frame.y - (current.frame.y + current.frame.height);
    const maxGap = Math.max(14, 0.8 * current.frame.height);
    const aligned = Math.abs(current.frame.x - line.frame.x) <= COLUMN_ALIGNMENT_TOLERANCE;

    if (aligned && gap >= 0 && gap <= maxGap && isContinuation(line)) {
      const mergedLines = [...current.lines, line];
      current.lines = mergedLines;
      current.text = mergedLines.map((item) => item.text.trim()).join(' ');
      current.frame = unionFrame(mergedLines);
      continue;
    }

    groups.push({ text: line.text.trim(), lines: [line], frame: unionFrame([line]) });
  }

  return groups;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --runInBand src/ocr/__tests__/groupMedicationLines.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/ocr/groupMedicationLines.ts apps/mobile/src/ocr/__tests__/groupMedicationLines.test.ts
git commit -m "feat: group medication ocr lines"
```

### Task 3: Extend OCR Section Mapper For Framed Sections

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\sectionMapper.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\types.ts`

- [ ] **Step 1: Write a failing assertion for instruction line preservation**

```ts
expect(result.sections.instruction).toEqual(['飯後服用']);
expect(result.sectionLines.instruction).toEqual([
  expect.objectContaining({ text: '飯後服用' }),
]);
```

- [ ] **Step 2: Run section mapper tests to verify failure**

Run: `npm test -- --runInBand src/ocr/__tests__/sectionMapper.test.ts`  
Expected: FAIL because framed section lines are not yet exposed

- [ ] **Step 3: Add framed section output**

```ts
export type SectionedOcr = {
  sections: Record<SectionKey, string[]>;
  sectionLines: Record<SectionKey, OcrLine[]>;
};
```

```ts
function buildEmptySectionLines(): Record<SectionKey, OcrLine[]> {
  return {
    medication: [],
    instruction: [],
    indications: [],
    warnings: [],
    side_effects: [],
    prescription_no: [],
    dispensing_date: [],
    unassigned: [],
  };
}
```

```ts
const sectionLines = buildEmptySectionLines();
// When assigning a line:
sections[targetRegion.key].push(cleanedText);
sectionLines[targetRegion.key].push(line);
// return { sections, sectionLines };
```

- [ ] **Step 4: Run the section mapper tests again**

Run: `npm test -- --runInBand src/ocr/__tests__/sectionMapper.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ocr/sectionMapper.ts apps/mobile/src/ocr/types.ts apps/mobile/src/ocr/__tests__/sectionMapper.test.ts
git commit -m "feat: preserve framed ocr section lines"
```

### Task 4: Persist OCR Sections And Grouped Medication Items During Case Creation

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\types\case.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\case.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\scan\CaseDraftScreen.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\__tests__\case.test.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\scan\__tests__\caseDraftScreen.test.tsx`

- [ ] **Step 1: Write failing test expectations for grouped RPC input and persisted instruction lines**

```ts
expect(rpc).toHaveBeenCalledWith('rx_match_medication_lines', {
  medication_lines: ['Spiriva Respimat 2.5 mcg/puff 80 puff/bottle'],
});

expect(insert).toHaveBeenCalledWith(
  expect.objectContaining({
    ocr_sections: {
      medication_lines: ['Spiriva Respimat', '2.5 mcg/puff 80 puff/bottle'],
      instruction_lines: ['飯後服用'],
    },
    detected_items: [
      expect.objectContaining({
        display_name: 'Spiriva Respimat 2.5 mcg/puff 80 puff/bottle',
      }),
    ],
  }),
);
```

- [ ] **Step 2: Run the case API test to verify it fails**

Run: `npm test -- --runInBand src/api/__tests__/case.test.ts`  
Expected: FAIL because grouping and `ocr_sections` persistence are not implemented yet

- [ ] **Step 3: Add case types for OCR sections**

```ts
export type StoredOcrSections = {
  medicationLines: string[];
  instructionLines: string[];
};

export type CreateCaseInput = {
  caseType: CaseType;
  photoUris: string[];
  ocrRawText: string;
  ingredientIds: string[];
  sectionedOcr?: SectionedOcr;
};

export type CaseRecord = {
  caseId: string;
  caseType: CaseType;
  createdAt: string;
  updatedAt: string;
  ocrRawText: string;
  ocrSections: StoredOcrSections;
  detectedItems: DetectedItem[];
  photoPaths: string[];
  photoUrls: string[];
  ingredientIds: string[];
  shareToAllCareTeams: boolean;
};
```

- [ ] **Step 4: Use grouped medication items in `createCase()`**

```ts
import { groupMedicationLinesIntoItems } from '../ocr/groupMedicationLines';

function getStoredOcrSections(input: CreateCaseInput): StoredOcrSections {
  return {
    medicationLines: input.sectionedOcr?.sections.medication ?? [],
    instructionLines: input.sectionedOcr?.sections.instruction ?? [],
  };
}

const medicationSectionLines = input.sectionedOcr?.sectionLines.medication ?? [];
const groupedMedicationItems =
  medicationSectionLines.length > 0
    ? groupMedicationLinesIntoItems(medicationSectionLines)
    : getMedicationCandidateLines(input).map((text) => ({ text }));

const medicationMatchInput = groupedMedicationItems.map((item) => item.text);
```

```ts
const storedOcrSections = getStoredOcrSections(input);

.insert({
  case_type: input.caseType,
  ocr_raw_text: input.ocrRawText,
  ocr_sections: {
    medication_lines: storedOcrSections.medicationLines,
    instruction_lines: storedOcrSections.instructionLines,
  },
  detected_items,
  ingredient_ids: uniqueIngredientIds,
  photo_paths: [],
  share_to_all_care_teams: true,
  user_id: userId,
})
```

- [ ] **Step 5: Update `CaseDraftScreen` to pass through full sectioned OCR**

```ts
setSectionedOcr(structured.blocks.length > 0 ? mapOcrSections(structured) : undefined);
```

Expected: no shape changes at the call site beyond preserving the richer `sectionedOcr`

- [ ] **Step 6: Run focused tests**

Run: `npm test -- --runInBand src/api/__tests__/case.test.ts src/scan/__tests__/caseDraftScreen.test.tsx`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/types/case.ts apps/mobile/src/api/case.ts apps/mobile/src/scan/CaseDraftScreen.tsx apps/mobile/src/api/__tests__/case.test.ts apps/mobile/src/scan/__tests__/caseDraftScreen.test.tsx
git commit -m "feat: persist grouped medication items and ocr sections"
```

### Task 5: Show Instruction Section On Case Page

**Files:**
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\api\case.ts`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\case\CasePageScreen.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\case\__tests__\casePageScreen.test.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\i18n\translations\en.json`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\i18n\translations\zh-TW.json`

- [ ] **Step 1: Write a failing case-page test for instruction rendering**

```ts
expect(screen.getByText('Instruction')).toBeTruthy();
expect(screen.getByText('Take after meals\nOnce daily')).toBeTruthy();
```

- [ ] **Step 2: Run the case page test to verify failure**

Run: `npm test -- --runInBand src/case/__tests__/casePageScreen.test.tsx`  
Expected: FAIL because `ocr_sections` is not yet surfaced or rendered

- [ ] **Step 3: Map `ocr_sections` from DB into `CaseRecord`**

```ts
type RxCaseRow = {
  // ...
  ocr_sections: {
    medication_lines?: string[] | null;
    instruction_lines?: string[] | null;
  } | null;
};

ocrSections: {
  medicationLines: row.ocr_sections?.medication_lines ?? [],
  instructionLines: row.ocr_sections?.instruction_lines ?? [],
},
```

- [ ] **Step 4: Render the instruction card only when lines exist**

```tsx
{caseRecord.ocrSections.instructionLines.length > 0 ? (
  <View style={styles.card}>
    <Text style={styles.sectionTitle}>{t('casePageInstructionTitle')}</Text>
    <Text style={styles.body}>{caseRecord.ocrSections.instructionLines.join('\n')}</Text>
  </View>
) : null}
```

- [ ] **Step 5: Add i18n keys**

```json
{
  "casePageInstructionTitle": "Instruction"
}
```

```json
{
  "casePageInstructionTitle": "用法"
}
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- --runInBand src/case/__tests__/casePageScreen.test.tsx`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/api/case.ts apps/mobile/src/case/CasePageScreen.tsx apps/mobile/src/case/__tests__/casePageScreen.test.tsx apps/mobile/src/i18n/translations/en.json apps/mobile/src/i18n/translations/zh-TW.json
git commit -m "feat: show instruction lines on case page"
```

### Task 6: Add DEV OCR Debug Screen And Entry

**Files:**
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\src\dev\OcrDebugScreen.tsx`
- Create: `e:\TRAE\Projects\RxNorm\apps\mobile\assets\ocr_samples\medicine_bag_sample.png`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\settings\SettingsScreen.tsx`
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\navigation\PatientTabs.tsx` or the settings stack file
- Modify: `e:\TRAE\Projects\RxNorm\apps\mobile\src\ocr\ocr.ts` only if asset URI helper is needed

- [ ] **Step 1: Copy the bundled sample image**

Source: `/workspace/.uploads/978361a7-5397-4922-b4cf-50d649ecc3c4_image.png`  
Destination: `apps/mobile/assets/ocr_samples/medicine_bag_sample.png`

- [ ] **Step 2: Write a tiny failing test or assertion for DEV-only entry hiding**

```ts
expect(screen.queryByText('DEV: OCR Debug')).toBeNull();
```

- [ ] **Step 3: Run the settings test if present or add a focused one**

Run: `npm test -- --runInBand src/settings/__tests__/...`  
Expected: FAIL because the DEV entry behavior is not implemented yet

- [ ] **Step 4: Implement the DEV-only debug screen**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Asset } from 'expo-asset';

import { runOcrOnImagesStructured } from '../ocr/ocr';
import { mapOcrSections } from '../ocr/sectionMapper';

export function OcrDebugScreen() {
  const [imageUri, setImageUri] = useState('');
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [sectionedOcr, setSectionedOcr] = useState<SectionedOcr | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadSample() {
      const asset = Asset.fromModule(require('../../assets/ocr_samples/medicine_bag_sample.png'));
      await asset.downloadAsync();
      if (!mounted || !asset.localUri) return;
      setImageUri(asset.localUri);
      const result = await runOcrOnImagesStructured([asset.localUri]);
      if (!mounted) return;
      setOcrResult(result);
      setSectionedOcr(mapOcrSections(result));
    }

    if (__DEV__) {
      void loadSample();
    }

    return () => {
      mounted = false;
    };
  }, []);

  // render image, line rectangles, and compact section counts
}
```

- [ ] **Step 5: Add a DEV-only settings entry**

```tsx
{__DEV__ ? (
  <Pressable onPress={() => navigation.navigate('OcrDebug')}>
    <Text>DEV: OCR Debug</Text>
  </Pressable>
) : null}
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- --runInBand src/settings/__tests__/...`  
Expected: PASS

- [ ] **Step 7: Manually verify on Android dev build**

Run:

```bash
cd e:/TRAE/Projects/RxNorm/apps/mobile
npx expo start --dev-client
```

Expected:
- DEV entry appears only in dev builds
- debug screen loads the bundled sample image
- line rectangles render over the image
- counts show medication/instruction/unassigned totals

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/assets/ocr_samples/medicine_bag_sample.png apps/mobile/src/dev/OcrDebugScreen.tsx apps/mobile/src/settings/SettingsScreen.tsx apps/mobile/src/navigation/PatientTabs.tsx
git commit -m "feat: add dev ocr debug screen"
```

### Task 7: Final Verification

**Files:**
- Modify: none unless verification finds issues

- [ ] **Step 1: Run the full mobile suite**

Run: `npm test -- --runInBand`  
Expected: PASS for all suites

- [ ] **Step 2: Check diagnostics on edited files**

Run: diagnostics on:
- `apps/mobile/src/ocr/groupMedicationLines.ts`
- `apps/mobile/src/ocr/sectionMapper.ts`
- `apps/mobile/src/api/case.ts`
- `apps/mobile/src/case/CasePageScreen.tsx`
- `apps/mobile/src/dev/OcrDebugScreen.tsx`
- `supabase/migrations/202605220002_add_ocr_sections_to_rx_cases.sql`

Expected: no TypeScript or SQL diagnostics

- [ ] **Step 3: Apply the DB migration**

Run: apply `supabase/migrations/202605220002_add_ocr_sections_to_rx_cases.sql`  
Expected: success

- [ ] **Step 4: Manual end-to-end check**

Expected:
- OCR medication lines get grouped into fewer, more complete detected items
- `ocr_sections.instruction_lines` is persisted on the case row
- Case Page renders the `Instruction` card when instructions exist
- DEV OCR Debug screen shows sample-image bounding boxes and compact section counts

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: group medication lines and persist ocr sections"
```
