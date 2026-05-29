import { normalizeOcrEnglishSpacing } from './normalizeOcrEnglish';

export function normalizeOcrForDetection(text: string): string {
  if (!text) return text;
  return normalizeOcrEnglishSpacing(text).toLowerCase();
}
