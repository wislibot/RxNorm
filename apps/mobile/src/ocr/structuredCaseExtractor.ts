import type { CaseFields } from '../types/caseFields';
import type { SectionedOcr } from './sectionMapper';

function findSectionLines(rawText: string, keywords: string[]): string[] {
  const lines = rawText.split(/\r?\n/);
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const results: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const content = extractContentAfterKeyword(trimmed, lowerKeywords);
    if (content !== null) {
      results.push(content);
    }
  }

  return results;
}

function extractContentAfterKeyword(line: string, keywords: string[]): string | null {
  const lower = line.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx === 0 || (idx > 0 && /^[:：]?\s*/.test(line.slice(idx + kw.length)))) {
      const after = line.slice(idx + kw.length).replace(/^[:：]\s*/, '').trim();
      if (after.length > 0) return after;
    }
  }
  return null;
}

function extractPatientName(rawText: string): string | null {
  const match = rawText.match(/姓名\s*[:：]\s*([\u4E00-\u9FFF]+)/);
  return match?.[1]?.trim() ?? null;
}

function isSectionHeaderLine(line: string): boolean {
  const patterns = [
    /^(?:用法|用途|警語|副作用|外觀|藥名|總量|調劑日期|領藥號|調劑藥師|處方期限)/,
    /^(?:instruction|indications|side effects|warnings|appearance|medication|quantity|use before|dispensing date|prescription|pharmacist)/i,
  ];
  const trimmed = line.trim();
  for (const pattern of patterns) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function extractPatientSex(rawText: string): 'M' | 'F' | null {
  const nameLine = rawText.match(/姓名\s*[:：].+/)?.[0];
  if (nameLine) {
    if (/男/.test(nameLine)) return 'M';
    if (/女/.test(nameLine)) return 'F';
  }

  let cutoffIndex = -1;
  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isSectionHeaderLine(lines[i])) {
      cutoffIndex = i;
      break;
    }
  }
  if (cutoffIndex === -1) {
    cutoffIndex = Math.min(lines.length, 30);
  }

  let foundM = false;
  let foundF = false;
  for (let i = 0; i < cutoffIndex; i++) {
    const trimmed = lines[i].trim();
    if (/^男\s*$/.test(trimmed)) foundM = true;
    if (/^女\s*$/.test(trimmed)) foundF = true;
  }

  if (foundM && !foundF) return 'M';
  if (foundF && !foundM) return 'F';
  return null;
}

function extractQuantity(rawText: string): string | null {
  const match = rawText.match(/[,，]?\s*總量\s*(\d+\s*[\u4E00-\u9FFF]{1,2})/);
  if (match?.[1]) {
    return match[1].replace(/\s+/g, '');
  }
  return null;
}

function extractPharmacyAddress(rawText: string): string | null {
  const match = rawText.match(/地址\s*[:：]\s*([^\n\r]+)/);
  return match?.[1]?.trim() ?? null;
}

function extractNameToken(value: string): string | null {
  const maskedCjk = value.match(/[\u4E00-\u9FFF]O{2,}/);
  if (maskedCjk?.[0]) return maskedCjk[0];
  const maskedLatin = value.match(/[A-Z][a-z]+O{2,}/);
  if (maskedLatin?.[0]) return maskedLatin[0];
  const cjkName = value.match(/[\u4E00-\u9FFF]{2,4}/);
  if (cjkName?.[0]) return cjkName[0];
  return null;
}

const NAME_LABEL_KEYWORDS = [
  '處方醫師', '醫師', 'physician',
  '調劑藥師', '藥師', 'pharmacist',
  '期限', 'use before', 'dispensing',
  '日期', 'date', '姓名', '用法',
  '用途', '警語', '副作用', '總量',
  '領藥號', '調劑日期', 'instruction',
  'indications', 'warnings', 'side effects',
  'medication', 'quantity', 'appearance',
];

function isNameLabelKeyword(line: string): boolean {
  const lower = line.trim().toLowerCase();
  return NAME_LABEL_KEYWORDS.some((k) => lower === k.toLowerCase());
}

function extractFirstNameToken(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 20) return null;
  if (isNameLabelKeyword(trimmed)) return null;

  const name = extractNameToken(trimmed);
  if (name) return name;

  if (/[\u4E00-\u9FFF]/.test(trimmed) || /[A-Za-z]{2,}/.test(trimmed)) {
    return trimmed.length <= 10 ? trimmed : null;
  }

  return null;
}

function extractPhysicianName(rawText: string): string | null {
  const match = rawText.match(/處方醫師[^\S\n\r]*[:：]?[^\S\n\r]*([^\n\r]+)/);
  if (match?.[1]) {
    const name = extractNameToken(match[1].trim());
    if (name) return name;
  }

  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('處方醫師') || lower.includes('physician')) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        if (isNameLabelKeyword(nextLine)) continue;
        const name = extractNameToken(nextLine);
        if (name) return name;
      }
    }
  }

  return null;
}

function extractPharmacistName(rawText: string): string | null {
  const typoPattern = /[調詞][劑制]?[\u85e5\u6a02]師[^\S\n\r]*[:：]?[^\S\n\r]*([^\n\r]+)/;
  const match = rawText.match(typoPattern);
  if (match?.[1]) {
    const name = extractNameToken(match[1].trim());
    if (name) return name;
  }

  const content = findSectionLines(rawText, ['調劑藥師', 'pharmacist']);
  if (content.length > 0) {
    const name = extractNameToken(content[0]);
    if (name) return name;
  }

  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].trim().toLowerCase();
    if (lower === 'pharmacist' || lower.includes('調劑藥師') || lower.includes('藥師')) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        if (isNameLabelKeyword(nextLine)) continue;
        const name = extractNameToken(nextLine);
        if (name) return name;
      }
    }
  }

  return null;
}

function extractPharmacyName(rawText: string): string | null {
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (/(?:醫院|診所|藥局|藥房)/.test(trimmed) && !trimmed.startsWith('地址') && !trimmed.includes('藥師')) {
      const match = trimmed.match(/([\u4E00-\u9FFFA-Za-z0-9]{2,12}(?:醫院|診所|藥局|藥房))/);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

function extractDispensingDate(rawText: string): string | null {
  const content = findSectionLines(rawText, ['調劑日期', 'dispensing date']);
  if (content.length > 0) {
    const dateStr = content[0].trim();
    const iso = parseDateToISO(dateStr);
    if (iso) return iso;
  }

  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('調劑日期') || lower.includes('dispensing date')) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        const iso = parseDateToISO(nextLine);
        if (iso) return iso;
        break;
      }
    }
  }

  return null;
}

function parseDateToISO(dateStr: string): string | null {
  const slashMatch = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slashMatch) {
    return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;
  }
  const dashMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dashMatch) {
    return `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`;
  }
  const dotMatch = dateStr.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (dotMatch) {
    return `${dotMatch[1]}-${dotMatch[2]}-${dotMatch[3]}`;
  }
  return null;
}

function isHeaderLine(line: string): boolean {
  const headers = [
    '用法', '用途', '警語', '副作用', '外觀', '藥名', '總量',
    '調劑日期', '領藥號', '調劑藥師', '處方期限',
    'instruction', 'indications', 'side effects', 'warnings',
    'appearance', 'medication', 'quantity', 'use before',
    'dispensing date', 'prescription', 'pharmacist',
  ];
  const lower = line.trim().toLowerCase();
  return headers.some((h) => lower === h.toLowerCase());
}

export function extractCaseFields(
  rawText: string,
  sectionedOcr?: SectionedOcr,
): CaseFields {
  const patientName = extractPatientName(rawText);
  const patientSex = extractPatientSex(rawText);
  const quantity = extractQuantity(rawText);
  const pharmacyAddress = extractPharmacyAddress(rawText);
  const pharmacistName = extractPharmacistName(rawText);
  const physicianName = extractPhysicianName(rawText);
  const pharmacyName = extractPharmacyName(rawText);
  const dispensingDate = extractDispensingDate(rawText);

  let directionsLines: string[];
  let indications: string[];
  let warnings: string[];
  let sideEffects: string[];

  if (sectionedOcr?.sections) {
    const sections = sectionedOcr.sections;
    directionsLines = sections.instruction.texts.filter((l) => !isHeaderLine(l));
    indications = sections.indications.texts;
    warnings = sections.warnings.texts;
    sideEffects = sections.side_effects.texts;
  } else {
    directionsLines = findSectionLines(rawText, ['用法', 'instruction']).filter((l) => !isHeaderLine(l));
    indications = findSectionLines(rawText, ['用途', 'indications']);
    warnings = findSectionLines(rawText, ['警語', 'warnings&precautions', 'warnings']);
    sideEffects = findSectionLines(rawText, ['副作用', 'side effects']);
  }

  const directions = directionsLines.join(', ') || null;

  return {
    directions,
    dispensingDate,
    indications,
    patientName,
    patientSex,
    pharmacistName,
    physicianName,
    pharmacyAddress,
    pharmacyName,
    quantity,
    sideEffects,
    warnings,
  };
}
