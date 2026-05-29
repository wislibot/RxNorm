import type { OcrLine, OcrRect } from './types';
import { sortLinesReadingOrder } from './sortReadingOrder';

export type GroupedItem = {
  text: string;
  lines: OcrLine[];
  frame: OcrRect;
  fromInlineHeader?: boolean;
};

export type GroupingAttempt = {
  currentText: string;
  nextText: string;
  overlapRatio: number;
  xDiff: number;
  gap: number;
  maxGap: number;
  merged: boolean;
  blockedByFarColumn: boolean;
};

export type MedicationGroupingDiagnostics = {
  candidateLines: OcrLine[];
  groupedItems: GroupedItem[];
  attempts: GroupingAttempt[];
};

const COLUMN_ALIGNMENT_TOLERANCE = 80;
const OVERLAP_RATIO_THRESHOLD = 0.15;
const FAR_COLUMN_OVERLAP_THRESHOLD = 0.1;
const FAR_COLUMN_X_DIFF = 120;
const LEFT_COL_MAX_X = 80;
const RIGHT_COL_MIN_X = 80;
const DOSAGE_RE = /\b\d+(?:\.\d+)?\s*(mcg|mg|g|ml|iu|%)\b/i;
const FORM_RE = /\b(tab|tablet|cap|capsule|syrup|inj|inhal|spray|solution|susp|respimat)\b|滴眼|錠|膠囊|口服|吸入|噴霧|注射|溶液|懸浮/i;
const CONTINUATION_RE = /\b(puff|puffs|bot|bottle)\b/i;
const HEADER_RE =
  /藥名|用法|用途|外觀|警語|副作用|領藥號|調劑日期|medication|instruction|indications|appearance|warnings|side effects|prescription|dispensing/i;
const META_LINE_RE =
  /^(?:藥名|外用|內用|口服|飯前|飯後|睡前|藥品資訊連結|藥品查詢|資訊連結|medication|quantity|use before|prescription|dispensing|appearance|instruction|indications|side effects|warnings|總量)\b/i;
const META_LINE_PREFIX_RE =
  /^(?:藥品資訊連結|藥品查詢|資訊連結|quantity|use before|prescription|dispensing|appearance|instruction|indications|side effects|warnings)\b/i;
const QUANTIFIER_RE = /盒|瓶|錠|粒/;
const CJK_CONTINUATION_RE = /噴|吸入|錠|膠囊|滴眼|注射|溶液|懸浮|粉|顆粒|口服/;
const CJK_RE = /[\u4E00-\u9FFF]/g;

function unionFrame(lines: OcrLine[]): OcrRect {
  const left = Math.min(...lines.map((line) => line.frame.x));
  const top = Math.min(...lines.map((line) => line.frame.y));
  const right = Math.max(...lines.map((line) => line.frame.x + line.frame.width));
  const bottom = Math.max(...lines.map((line) => line.frame.y + line.frame.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function isHeader(line: OcrLine) {
  return HEADER_RE.test(line.text);
}

function frameRight(frame: OcrRect) {
  return frame.x + frame.width;
}

function frameBottom(frame: OcrRect) {
  return frame.y + frame.height;
}

function horizontalOverlap(a: OcrRect, b: OcrRect) {
  return Math.max(0, Math.min(frameRight(a), frameRight(b)) - Math.max(a.x, b.x));
}

function countCjk(text: string) {
  return (text.match(CJK_RE) ?? []).length;
}

function looksLikeNewItemStart(text: string) {
  return HEADER_RE.test(text) || /^[*•·\-–—]/.test(text);
}

function normalizeText(text: string) {
  return text.trim().replace(/\bpaff\b/gi, 'puff').replace(/\s+/g, ' ');
}

function stripInlineHeaderPrefix(text: string) {
  const normalized = normalizeText(text);
  const englishMatch = normalized.match(/^(medication)\s+(.+)$/i);
  if (englishMatch?.[2]?.trim()) {
    return englishMatch[2].trim();
  }

  const chineseMatch = normalized.match(/^(藥名)\s*(.+)$/);
  if (chineseMatch?.[2]?.trim()) {
    return chineseMatch[2].trim();
  }

  return normalized;
}

function stripTrailingQuantity(text: string) {
  let normalized = text.trim();
  normalized = normalized.replace(/[,，]?\s*總量\s*\d+\s*(盒|瓶|支|包|顆|粒|錠|金)/gi, '');
  normalized = normalized.replace(/[,，]?\s*總量\s*\d+\s*[\u4E00-\u9FFF]{1,2}/g, '');
  normalized = normalized.replace(/[,，]?\s*quantity\s*\d+\s*(box|bottle|pack|packs|tabs?|caps?)/gi, '');
  return normalized.trim().replace(/\s{2,}/g, ' ');
}

function isMedicationLabelNoise(text: string) {
  const normalized = stripInlineHeaderPrefix(text);
  if (META_LINE_RE.test(normalized) || META_LINE_PREFIX_RE.test(normalized)) {
    return true;
  }

  const cleaned = normalized
    .toLowerCase()
    .replace(
      /quantity|appearance|instruction|indications|warnings?|side effects?|prescription|dispensing|use before|藥名|總量|外觀|用法|用途|警語|副作用|領藥號|調劑日期|外用|內用|飯前|飯後|睡前|藥品資訊連結|藥品查詢|資訊連結/g,
      '',
    )
    .replace(/[:：,，.\-()/\s]/g, '');

  return cleaned.length === 0;
}

const QUANTITY_ONLY_RE = /^\d+\s*(盒|瓶|支|包|顆|粒|錠|会|合|金)$/;

export function isQuantityOnlyLine(text: string): boolean {
  const trimmed = text.trim().replace(/\s+/g, '');
  return QUANTITY_ONLY_RE.test(trimmed);
}

function hasInlineDetail(text: string) {
  return DOSAGE_RE.test(text) || CONTINUATION_RE.test(text) || QUANTIFIER_RE.test(text) || text.includes('(');
}

function isContinuation(line: OcrLine) {
  const text = normalizeText(line.text);
  const cjkCount = countCjk(text);
  const cjkRatio = cjkCount / Math.max(1, text.length);

  return (
    text.startsWith('(') ||
    DOSAGE_RE.test(text) ||
    CONTINUATION_RE.test(text) ||
    (text.length <= 10 && QUANTIFIER_RE.test(text)) ||
    ((cjkRatio >= 0.5 && text.length <= 25) || CJK_CONTINUATION_RE.test(text))
  );
}

function isInlineHeaderLine(text: string): boolean {
  const normalized = normalizeText(text);
  return /^(medication|藥名)\s+.+/i.test(normalized);
}

function centerY(frame: OcrRect): number {
  return frame.y + frame.height / 2;
}

function mergeCrossColumnInlineRows(groups: GroupedItem[]): GroupedItem[] {
  const merges = new Map<number, number[]>();
  const mergedIndices = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group.fromInlineHeader || group.frame.x >= LEFT_COL_MAX_X) {
      continue;
    }

    const sourceCenter = centerY(group.frame);
    let bestTargetIdx = -1;
    let bestDy = Infinity;

    for (let j = 0; j < groups.length; j++) {
      if (j === i) continue;
      const candidate = groups[j];
      if (candidate.frame.x < RIGHT_COL_MIN_X) continue;
      if (isMedicationLabelNoise(candidate.text)) continue;

      const dy = Math.abs(sourceCenter - centerY(candidate.frame));
      const maxDy = Math.max(30, 1.8 * Math.min(group.frame.height, candidate.frame.height));

      if (dy <= maxDy && dy < bestDy) {
        bestTargetIdx = j;
        bestDy = dy;
      }
    }

    if (bestTargetIdx >= 0) {
      const existing = merges.get(bestTargetIdx) ?? [];
      existing.push(i);
      merges.set(bestTargetIdx, existing);
      mergedIndices.add(i);
    }
  }

  const result: GroupedItem[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (mergedIndices.has(i)) continue;

    const group = { ...groups[i] };
    const sourceIndices = merges.get(i);

    if (sourceIndices && sourceIndices.length > 0) {
      const allLines = [...group.lines];
      for (const si of sourceIndices) {
        allLines.push(...groups[si].lines);
      }
      group.lines = allLines;
      group.text = stripTrailingQuantity(allLines.map((l) => l.text).join(' '));
      group.frame = unionFrame(allLines);
    }

    result.push(group);
  }

  return result;
}

type ProcessedLine = OcrLine & { fromInlineHeader?: boolean };

export function analyzeMedicationLineGrouping(lines: OcrLine[]): MedicationGroupingDiagnostics {
  const processedLines: ProcessedLine[] = lines
    .map((line) => ({
      ...line,
      text: stripInlineHeaderPrefix(line.text),
      fromInlineHeader: isInlineHeaderLine(line.text),
    } as ProcessedLine))
    .filter((line) => line.text.length > 0)
    .filter((line) => !isMedicationLabelNoise(line.text))
    .filter((line) => !isQuantityOnlyLine(line.text));

  const sortedLines = sortLinesReadingOrder(processedLines);

  const groups: GroupedItem[] = [];
  const attempts: GroupingAttempt[] = [];

  for (const line of sortedLines) {
    const current = groups[groups.length - 1];
    const processed = line as ProcessedLine;
    if (!current || isHeader(line)) {
      groups.push({
        text: stripTrailingQuantity(line.text),
        lines: [line],
        frame: unionFrame([line]),
        fromInlineHeader: processed.fromInlineHeader ?? false,
      });
      continue;
    }

    const gap = line.frame.y - (current.frame.y + current.frame.height);
    const maxGap = Math.max(24, 2.2 * current.frame.height);
    const overlap = horizontalOverlap(current.frame, line.frame);
    const overlapRatio = overlap / Math.max(1, Math.min(current.frame.width, line.frame.width));
    const xDiff = Math.abs(current.frame.x - line.frame.x);
    const aligned = overlapRatio >= OVERLAP_RATIO_THRESHOLD || xDiff <= COLUMN_ALIGNMENT_TOLERANCE;
    const blockedByFarColumn = overlapRatio < FAR_COLUMN_OVERLAP_THRESHOLD && xDiff > FAR_COLUMN_X_DIFF;
    const stopBecauseComplete =
      isMedicationLabelNoise(line.text) || (hasInlineDetail(current.text) && looksLikeNewItemStart(line.text));
    const shouldMerge =
      aligned &&
      gap >= 0 &&
      gap <= maxGap &&
      isContinuation(line) &&
      !stopBecauseComplete &&
      !blockedByFarColumn;

    attempts.push({
      blockedByFarColumn,
      currentText: current.text,
      gap,
      maxGap,
      merged: shouldMerge,
      nextText: line.text,
      overlapRatio,
      xDiff,
    });

    if (shouldMerge) {
      const mergedLines = [...current.lines, line];
      current.lines = mergedLines;
      current.text = stripTrailingQuantity(mergedLines.map((item) => item.text).join(' '));
      current.frame = unionFrame(mergedLines);
      current.fromInlineHeader = current.fromInlineHeader || (processed.fromInlineHeader ?? false);
      continue;
    }

    groups.push({
      text: stripTrailingQuantity(line.text),
      lines: [line],
      frame: unionFrame([line]),
      fromInlineHeader: processed.fromInlineHeader ?? false,
    });
  }

  const mergedGroups = mergeCrossColumnInlineRows(groups);

  return {
    attempts,
    candidateLines: sortedLines,
    groupedItems: mergedGroups,
  };
}

export function groupMedicationLinesIntoItems(lines: OcrLine[]): GroupedItem[] {
  return analyzeMedicationLineGrouping(lines).groupedItems;
}
