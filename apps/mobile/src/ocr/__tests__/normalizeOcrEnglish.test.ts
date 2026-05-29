import { normalizeOcrEnglishSpacing } from '../normalizeOcrEnglish';

describe('normalizeOcrEnglishSpacing', () => {
  test('merges "Medi cation 60puff" into "Medication 60puff"', () => {
    expect(normalizeOcrEnglishSpacing('Medi cation 60puff')).toBe('Medication 60puff');
  });

  test('merges "Respi mat" into "Respimat"', () => {
    expect(normalizeOcrEnglishSpacing('Respi mat')).toBe('Respimat');
  });

  test('merges "Warnings&Precaut ions" into "Warnings & Precautions"', () => {
    expect(normalizeOcrEnglishSpacing('Warnings&Precaut ions')).toBe('Warnings & Precautions');
  });

  test('fixes "Physiciam" into "Physician"', () => {
    expect(normalizeOcrEnglishSpacing('Physiciam')).toBe('Physician');
  });

  test('merges "Pharmaci st" into "Pharmacist"', () => {
    expect(normalizeOcrEnglishSpacing('Pharmaci st')).toBe('Pharmacist');
  });

  test('returns empty string unchanged', () => {
    expect(normalizeOcrEnglishSpacing('')).toBe('');
  });

  test('does not merge words when combined length > 20', () => {
    const longText = 'abcdefghijklmnop abcdefghijklmnopqrstuvwxyz';
    expect(normalizeOcrEnglishSpacing(longText)).toBe(longText);
  });

  test('does not merge non-alpha tokens', () => {
    expect(normalizeOcrEnglishSpacing('總量 1盒')).toBe('總量 1盒');
  });

  test('handles multi-pass merging', () => {
    expect(normalizeOcrEnglishSpacing('medi ca tion')).toBe('medication');
  });

  test('does not merge blacklisted abbreviations', () => {
    expect(normalizeOcrEnglishSpacing('AMOXICILLIN 500 MG CAPSULE')).toBe('AMOXICILLIN 500 MG CAPSULE');
  });

  test('does not merge two long words (>= 5 each)', () => {
    expect(normalizeOcrEnglishSpacing('Spiriva Respimat')).toBe('Spiriva Respimat');
  });
});
