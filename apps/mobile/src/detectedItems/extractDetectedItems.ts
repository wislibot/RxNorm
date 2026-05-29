import type { DetectedItem } from '../types/case';
import type { SectionedOcr } from '../ocr/sectionMapper';
import { groupMedicationLinesIntoItems } from '../ocr/groupMedicationLines';

const DOSAGE_RE = /\b\d+(?:\.\d+)?\s*(mg|mcg|g|ml|iu|%)\b/i;
const PUFF_RE = /\b(?:puff|puffs)\b|\b\d+\s*puff\b/i;
const FORM_RE =
  /\b(tab|tablet|cap|capsule|syrup|inj|inhal|spray|solution|susp|respimat)\b|滴眼|錠|膠囊|口服|吸入|噴霧|注射|溶液|懸浮/i;
const PAREN_HINT_RE = /\(([A-Za-z][^)]+)\)/;
const PHONE_OR_CODE_RE = /(?:\b\d{2,3}\d{6,}\b|\b\d{2,4}-\d{3,4}-\d{3,4}\b|^\d{3,}$)/;
const BOILERPLATE_RE =
  /\b(prescription|quantity|dispensing|pharmacist|physician|warnings|warning|side effects|instruction|appearance|use before)\b|領藥號|總量|用法|用途|外觀|警語|副作用|處方期限|調劑日期|藥師|醫師/i;
const LETTER_DIGIT_MIX_RE = /(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]/;
const CJK_RE = /[\u3400-\u9fff]/;

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePunctuationRepeats(value: string) {
  return value.replace(/[.,;:]{2,}/g, (match) => match[0] ?? '');
}

function normalizeUnits(value: string) {
  return value
    .replace(/\bm\s*c\s*g\b/gi, 'mcg')
    .replace(/\bpaff\b/gi, 'puff');
}

function normalizeDoseTokenDigits(value: string) {
  return value.replace(
    /\b([0-9OIllo]+(?:\.[0-9OIllo]+)?)(\s*)(mcg|mg|g|ml|iu|%)\b/gi,
    (_, numericPart: string, separator: string, unit: string) => {
      const normalizedNumber = numericPart.replace(/[Oo]/g, '0').replace(/[Iil]/g, '1');
      return `${normalizedNumber}${separator}${unit}`;
    },
  );
}

function preCleanLine(line: string) {
  const trimmed = collapseSpaces(line);
  const noBullet = trimmed.replace(/^[*•·\-–—]+\s*/, '');
  return collapseSpaces(normalizeDoseTokenDigits(normalizeUnits(normalizePunctuationRepeats(noBullet))));
}

function hasDosage(line: string) {
  return DOSAGE_RE.test(line);
}

function hasForm(line: string) {
  return FORM_RE.test(line) || PUFF_RE.test(line);
}

function hasParenthesisHint(line: string) {
  return PAREN_HINT_RE.test(line);
}

function isBoilerplate(line: string) {
  return BOILERPLATE_RE.test(line);
}

function isHardNoise(line: string) {
  return PHONE_OR_CODE_RE.test(line) || isBoilerplate(line) || (line.length < 4 && !hasDosage(line));
}

function looksLikeNameLine(line: string) {
  return !isHardNoise(line) && (/[A-Za-z]/.test(line) || shouldKeep(line));
}

function looksLikeContinuation(line: string) {
  return hasDosage(line) || hasForm(line) || hasParenthesisHint(line);
}

function isMergeableHeader(line: string) {
  return looksLikeNameLine(line) && !hasDosage(line) && !hasParenthesisHint(line);
}

function shouldKeep(line: string) {
  return hasDosage(line) || hasForm(line) || hasParenthesisHint(line) || LETTER_DIGIT_MIX_RE.test(line);
}

function scoreConfidence(line: string) {
  let score = 0.5;
  if (hasDosage(line)) {
    score += 0.2;
  }
  if (hasForm(line)) {
    score += 0.2;
  }
  if (PUFF_RE.test(line) && !hasDosage(line)) {
    score += 0.2;
  }
  if (hasParenthesisHint(line)) {
    score += 0.1;
  }
  return Math.min(0.95, Math.round(score * 100) / 100);
}

type ExtractDetectedItemsInput = {
  ocrRawText: string;
  sectionedOcr?: SectionedOcr;
};

function getMedicationSectionLines(sectionedOcr?: SectionedOcr) {
  return sectionedOcr?.sections.medication.texts ?? [];
}

function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const dedupeKey = line.toLowerCase();
    if (seen.has(dedupeKey)) {
      return false;
    }
    seen.add(dedupeKey);
    return true;
  });
}

function mergeMedicationCandidates(lines: string[]) {
  const cleanedLines = lines
    .map((line) => preCleanLine(line))
    .filter((line) => line.length > 0)
    .filter((line) => !isHardNoise(line));

  const mergedCandidates: string[] = [];

  for (let index = 0; index < cleanedLines.length; index += 1) {
    const currentLine = cleanedLines[index];
    const nextLine = cleanedLines[index + 1];

    if (
      currentLine &&
      nextLine &&
      currentLine.toLowerCase() !== nextLine.toLowerCase() &&
      isMergeableHeader(currentLine) &&
      looksLikeContinuation(nextLine)
    ) {
      mergedCandidates.push(collapseSpaces(`${currentLine} ${nextLine}`));
      index += 1;
      continue;
    }

    mergedCandidates.push(currentLine);
  }

  return dedupeLines(mergedCandidates);
}

function getCandidateLines({ ocrRawText, sectionedOcr }: ExtractDetectedItemsInput) {
  const medicationSection = sectionedOcr?.sections.medication;
  if ((medicationSection?.lines.length ?? 0) > 0) {
    return groupMedicationLinesIntoItems(medicationSection!.lines).map((item) => item.text);
  }

  const medicationLines = getMedicationSectionLines(sectionedOcr);
  if (medicationLines.length > 0) {
    return mergeMedicationCandidates(medicationLines).filter((line) => looksLikeNameLine(line) || shouldKeep(line));
  }

  return ocrRawText.split(/\r?\n/);
}

export function extractDetectedItems({ ocrRawText, sectionedOcr }: ExtractDetectedItemsInput): DetectedItem[] {
  const cleanedLines = mergeMedicationCandidates(getCandidateLines({ ocrRawText, sectionedOcr }));

  return dedupeLines(cleanedLines)
    .filter((line) => shouldKeep(line))
    .map((displayName) => ({
      confidence: scoreConfidence(displayName),
      displayName,
      ingredientId: undefined,
      matchStatus: 'unmatched' as const,
      nhiCode: undefined,
      note: null,
      rawText: displayName,
      source: 'ocr_line' as const,
    }));
}
