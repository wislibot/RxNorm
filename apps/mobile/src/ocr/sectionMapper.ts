import type { OcrLine, OcrResult, RemoteOcrResult } from './types';
import { sortLinesReadingOrder } from './sortReadingOrder';
import { normalizeOcrForDetection } from './normalizeOcrForDetection';
import { isQuantityOnlyLine } from './groupMedicationLines';

export type SectionKey =
  | 'medication'
  | 'instruction'
  | 'indications'
  | 'warnings'
  | 'side_effects'
  | 'prescription_no'
  | 'dispensing_date'
  | 'quantity'
  | 'pharmacist'
  | 'unassigned';

export type SectionEntry = {
  lines: OcrLine[];
  texts: string[];
};

export type PhotoSectionAttribution = {
  photoIndex: number;
  sections: Partial<Record<SectionKey, { lineCount: number; texts: string[] }>>;
};

export type SectionedOcr = {
  rawLines?: OcrLine[];
  sortedLines?: OcrLine[];
  sections: Record<SectionKey, SectionEntry>;
  modelData?: RemoteOcrResult;
  photoAttributions?: PhotoSectionAttribution[];
};

type AnchorDefinition = {
  key: Exclude<SectionKey, 'unassigned'>;
  keywords: string[];
};

type AnchorMatch = {
  key: Exclude<SectionKey, 'unassigned'>;
  line: OcrLine;
};

type Region = {
  key: Exclude<SectionKey, 'unassigned'>;
  xStart: number;
  yStart: number;
  yEnd: number;
};

const REGION_PADDING_Y = 6;
const INLINE_MEDICATION_HEADER_RE = /^(medication)\b/i;
const INLINE_MEDICATION_HEADER_ZH_RE = /^藥名/;
const MEDICINE_SIGNAL_RE = /\b\d+(?:\.\d+)?\s*(mcg|mg|g|ml|iu|%)\b|\b(puff|puffs|bot|bottle)\b|\([^)]*[A-Za-z][^)]*\)/i;

const ANCHORS: AnchorDefinition[] = [
  { key: 'medication', keywords: ['藥名', 'medication', '處方', '次量'] },
  { key: 'instruction', keywords: ['用法', 'instruction'] },
  { key: 'indications', keywords: ['用途', 'indications'] },
  { key: 'warnings', keywords: ['警語', 'warnings'] },
  { key: 'side_effects', keywords: ['副作用', 'side effects'] },
  { key: 'prescription_no', keywords: ['領藥號', 'prescription no.'] },
  { key: 'dispensing_date', keywords: ['調劑日期', 'dispensing date'] },
  { key: 'quantity', keywords: ['總量', 'quantity'] },
  { key: 'pharmacist', keywords: ['調劑藥師', 'pharmacist'] },
];

function buildEmptySectionEntry(): SectionEntry {
  return {
    lines: [],
    texts: [],
  };
}

function buildEmptySections(): SectionedOcr['sections'] {
  return {
    medication: buildEmptySectionEntry(),
    instruction: buildEmptySectionEntry(),
    indications: buildEmptySectionEntry(),
    warnings: buildEmptySectionEntry(),
    side_effects: buildEmptySectionEntry(),
    prescription_no: buildEmptySectionEntry(),
    dispensing_date: buildEmptySectionEntry(),
    quantity: buildEmptySectionEntry(),
    pharmacist: buildEmptySectionEntry(),
    unassigned: buildEmptySectionEntry(),
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function flattenLines(result: OcrResult): OcrLine[] {
  return result.blocks.flatMap((block) => block.lines ?? []).filter((line) => line.text.trim().length > 0);
}

function detectAnchors(lines: OcrLine[]): AnchorMatch[] {
  return lines
    .flatMap((line) => {
      const text = normalizeOcrForDetection(line.text);

      if (isInlineMedicationValueLine(line)) {
        return [];
      }

      const matches = ANCHORS.filter((anchor) =>
        anchor.keywords.some((keyword) => {
          const normalizedKw = keyword.toLowerCase();
          if (text === normalizedKw) return true;
          if (text.includes(normalizedKw)) {
            if (anchor.key !== 'medication' && MEDICINE_SIGNAL_RE.test(text)) return false;
            return true;
          }
          return false;
        }),
      );
      return matches.map((match) => ({ key: match.key, line }));
    })
    .sort((left, right) => left.line.frame.y - right.line.frame.y);
}

function buildRegions(lines: OcrLine[], anchors: AnchorMatch[]): Region[] {
  const pageBottom = lines.reduce((max, line) => Math.max(max, line.frame.y + line.frame.height), 0);

  return anchors.map((anchor, index) => ({
    key: anchor.key,
    xStart: anchor.line.frame.x,
    yStart: Math.max(0, anchor.line.frame.y - REGION_PADDING_Y),
    yEnd:
      index < anchors.length - 1
        ? Math.max(anchor.line.frame.y, anchors[index + 1]!.line.frame.y - REGION_PADDING_Y)
        : pageBottom + REGION_PADDING_Y,
  }));
}

function isAnchorLine(line: OcrLine, anchors: AnchorMatch[]) {
  if (isInlineMedicationValueLine(line)) {
    return false;
  }

  return anchors.some(
    (anchor) =>
      anchor.line.text === line.text &&
      anchor.line.frame.x === line.frame.x &&
      anchor.line.frame.y === line.frame.y &&
      anchor.line.frame.width === line.frame.width &&
      anchor.line.frame.height === line.frame.height,
  );
}

function overlapHeight(line: OcrLine, region: Region) {
  const lineStart = line.frame.y;
  const lineEnd = line.frame.y + line.frame.height;
  const overlapStart = Math.max(lineStart, region.yStart);
  const overlapEnd = Math.min(lineEnd, region.yEnd);
  return Math.max(0, overlapEnd - overlapStart);
}

function isInlineMedicationValueLine(line: OcrLine) {
  const text = normalizeOcrForDetection(line.text);
  const hasHeader = INLINE_MEDICATION_HEADER_RE.test(text) || INLINE_MEDICATION_HEADER_ZH_RE.test(text);
  return hasHeader && MEDICINE_SIGNAL_RE.test(text);
}

function appendLine(sections: SectionedOcr['sections'], key: SectionKey, line: OcrLine) {
  const cleanedText = line.text.trim();
  if (!cleanedText) {
    return;
  }

  sections[key].lines.push(line);
  sections[key].texts.push(cleanedText);
}

function buildPhotoAttributions(
  sections: SectionedOcr['sections'],
  linePhotoMap: Map<string, number>,
): PhotoSectionAttribution[] {
  const photoMap = new Map<number, PhotoSectionAttribution>();

  for (const [sectionKey, entry] of Object.entries(sections)) {
    if (sectionKey === 'unassigned') continue;
    for (const line of entry.lines) {
      const photoIndex = line.photoIndex ?? 0;
      let attr = photoMap.get(photoIndex);
      if (!attr) {
        attr = { photoIndex, sections: {} };
        photoMap.set(photoIndex, attr);
      }
      const key = sectionKey as SectionKey;
      if (!attr.sections[key]) {
        attr.sections[key] = { lineCount: 0, texts: [] };
      }
      attr.sections[key]!.lineCount += 1;
      if (line.text.trim()) {
        attr.sections[key]!.texts.push(line.text.trim());
      }
    }
  }

  return Array.from(photoMap.values()).sort((a, b) => a.photoIndex - b.photoIndex);
}

export function mapOcrSections(result: OcrResult): SectionedOcr {
  const sections = buildEmptySections();
  const rawLines = flattenLines(result);
  const lines = sortLinesReadingOrder(rawLines);
  const anchors = detectAnchors(lines);

  if (!anchors.length) {
    for (const line of lines) {
      appendLine(sections, 'unassigned', line);
    }
    const photoAttributions = buildPhotoAttributions(sections, new Map());
    return { rawLines, sections, sortedLines: lines, modelData: result.modelData, photoAttributions };
  }

  const regions = buildRegions(lines, anchors);

  for (const line of lines) {
    if (!line.text.trim() || isAnchorLine(line, anchors)) {
      continue;
    }

    const matchingRegions = regions
      .filter(
        (region) =>
          overlapHeight(line, region) > 0 &&
          (line.frame.x >= region.xStart || (region.key === 'medication' && isInlineMedicationValueLine(line))),
      )
      .sort((left, right) => overlapHeight(line, right) - overlapHeight(line, left));

    const targetRegion = matchingRegions[0];
    if (targetRegion) {
      if (targetRegion.key === 'medication' && isQuantityOnlyLine(line.text)) {
        appendLine(sections, 'unassigned', line);
      } else {
        appendLine(sections, targetRegion.key, line);
      }
    } else {
      appendLine(sections, 'unassigned', line);
    }
  }

  const photoAttributions = buildPhotoAttributions(sections, new Map());

  return { rawLines, sections, sortedLines: lines, modelData: result.modelData, photoAttributions };
}
