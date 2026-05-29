import { extractDetectedItems } from '../extractDetectedItems';
import type { SectionedOcr } from '../../ocr/sectionMapper';

describe('extractDetectedItems', () => {
  test('uses medication section lines only when sectioned OCR is provided', () => {
    const sectionedOcr: SectionedOcr = {
      sections: {
        medication: {
          lines: [
            { text: 'AMOXICILLIN 500 MG CAPSULE', frame: { x: 120, y: 42, width: 180, height: 16 } },
            { text: 'METFORMIN 500 MG TAB', frame: { x: 120, y: 64, width: 160, height: 16 } },
          ],
          texts: ['AMOXICILLIN 500 MG CAPSULE', 'METFORMIN 500 MG TAB'],
        },
        instruction: {
          lines: [{ text: 'Take after meals', frame: { x: 120, y: 122, width: 80, height: 16 } }],
          texts: ['Take after meals'],
        },
        indications: { lines: [], texts: [] },
        warnings: { lines: [], texts: [] },
        side_effects: { lines: [], texts: [] },
        prescription_no: {
          lines: [{ text: '123456789', frame: { x: 120, y: 150, width: 80, height: 16 } }],
          texts: ['123456789'],
        },
        dispensing_date: { lines: [], texts: [] },
        unassigned: {
          lines: [{ text: '(06)2677282', frame: { x: 18, y: 250, width: 90, height: 16 } }],
          texts: ['(06)2677282'],
        },
      },
    };

    const result = extractDetectedItems({
      ocrRawText: `
        用法
        Take after meals
        (06)2677282
      `,
      sectionedOcr,
    });

    expect(result.map((item) => item.displayName)).toEqual([
      'AMOXICILLIN 500 MG CAPSULE METFORMIN 500 MG TAB',
    ]);
  });

  test('extracts deterministic OCR-derived items from mixed Chinese and English OCR text', () => {
    const result = extractDetectedItems({
      ocrRawText: `
        Prescription copy
        AMOXICILLIN 500 MG CAPSULE
        每日三次
        METFORMIN 500mg tab
        滴眼液 5 ML
        OK
      `,
    });

    expect(result).toEqual([
      expect.objectContaining({
        displayName: 'AMOXICILLIN 500 MG CAPSULE',
        confidence: 0.9,
        matchStatus: 'unmatched',
        source: 'ocr_line',
      }),
      expect.objectContaining({
        displayName: 'METFORMIN 500mg tab',
        confidence: 0.9,
        matchStatus: 'unmatched',
        source: 'ocr_line',
      }),
      expect.objectContaining({
        displayName: '滴眼液 5 ML',
        confidence: 0.9,
        matchStatus: 'unmatched',
        source: 'ocr_line',
      }),
    ]);
  });

  test('drops phone numbers, code noise, and boilerplate lines', () => {
    const result = extractDetectedItems({
      ocrRawText: `
        領藥號 123456789
        02-1234-5678
        20260521
        藥師：王小明
        Use before 2026/12
        METFORMIN 500 MG TAB
      `,
    });

    expect(result).toEqual([
      expect.objectContaining({
        displayName: 'METFORMIN 500 MG TAB',
      }),
    ]);
  });

  test('merges adjacent lines when the next line looks like a medicine continuation', () => {
    const result = extractDetectedItems({
      ocrRawText: `
        * Spiriva Respimat
        2 paff (tiotropium)
        每日一次
      `,
    });

    expect(result).toEqual([
      expect.objectContaining({
        displayName: 'Spiriva Respimat 2 puff (tiotropium)',
        confidence: 0.95,
      }),
    ]);
  });

  test('deduplicates identical OCR lines after whitespace normalization', () => {
    const result = extractDetectedItems({
      ocrRawText: `
        AMOXICILLIN   500 MG CAPSULE
        AMOXICILLIN 500 MG CAPSULE
      `,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.displayName).toBe('AMOXICILLIN 500 MG CAPSULE');
  });
});
