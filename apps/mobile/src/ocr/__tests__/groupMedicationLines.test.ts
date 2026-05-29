import { analyzeMedicationLineGrouping, groupMedicationLinesIntoItems, isQuantityOnlyLine } from '../groupMedicationLines';
import type { OcrLine } from '../types';

describe('isQuantityOnlyLine', () => {
  test('matches quantity-only lines like 1盒, 2瓶, 3支, 4包, 5顆, 6粒, 7錠', () => {
    expect(isQuantityOnlyLine('1盒')).toBe(true);
    expect(isQuantityOnlyLine('2 瓶')).toBe(true);
    expect(isQuantityOnlyLine('3支')).toBe(true);
    expect(isQuantityOnlyLine('4  包')).toBe(true);
    expect(isQuantityOnlyLine('5顆')).toBe(true);
    expect(isQuantityOnlyLine('6粒')).toBe(true);
    expect(isQuantityOnlyLine('7錠')).toBe(true);
  });

  test('matches OCR typo variants 1会, 1合, 1金', () => {
    expect(isQuantityOnlyLine('1会')).toBe(true);
    expect(isQuantityOnlyLine('1 合')).toBe(true);
    expect(isQuantityOnlyLine('1金')).toBe(true);
  });

  test('does not match lines with medication names', () => {
    expect(isQuantityOnlyLine('Spiriva Respimat 2.5mcg/puff')).toBe(false);
    expect(isQuantityOnlyLine('60puff/bot(tiotropium)')).toBe(false);
    expect(isQuantityOnlyLine('適喘樂舒噴吸入劑')).toBe(false);
    expect(isQuantityOnlyLine('AMOXICILLIN 500 MG')).toBe(false);
  });

  test('does not match lines that have quantity as part of larger text', () => {
    expect(isQuantityOnlyLine('Spiriva Respimat 2.5mcg/puff, 總量1盒')).toBe(false);
    expect(isQuantityOnlyLine('總量1盒')).toBe(false);
    expect(isQuantityOnlyLine('Take 1 盒 daily')).toBe(false);
  });

  test('quantity-only lines are filtered from medication grouping output', () => {
    const lines: OcrLine[] = [
      { text: 'Spiriva Respimat 2.5mcg/puff', frame: { x: 116, y: 40, width: 220, height: 16 } },
      { text: '1盒', frame: { x: 330, y: 42, width: 30, height: 14 } },
      { text: '60puff/bot(tiotropium)', frame: { x: 150, y: 63, width: 155, height: 16 } },
    ];

    const result = groupMedicationLinesIntoItems(lines);

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('Spiriva Respimat');
    expect(result[0]?.text).toContain('60puff/bot(tiotropium)');
    expect(result[0]?.text).not.toContain('1盒');
  });
});

describe('groupMedicationLinesIntoItems', () => {
  test('merges the Spiriva three-line bilingual medication block into one grouped item', () => {
    const lines: OcrLine[] = [
      { text: 'Spiriva Respimat 2.5mcg/puff', frame: { x: 120, y: 40, width: 170, height: 16 } },
      { text: '60puff/bot(tiotropium)', frame: { x: 150, y: 63, width: 155, height: 16 } },
      { text: '適喘樂舒噴吸入劑', frame: { x: 138, y: 85, width: 140, height: 16 } },
    ];

    const result = groupMedicationLinesIntoItems(lines);

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('Spiriva Respimat 2.5mcg/puff');
    expect(result[0]?.text).toContain('60puff/bot(tiotropium)');
    expect(result[0]?.text).toContain('適喘樂舒噴吸入劑');
    expect(result[0]?.text).toBe('Spiriva Respimat 2.5mcg/puff 60puff/bot(tiotropium) 適喘樂舒噴吸入劑');
  });

  test('merges vertically adjacent aligned medication lines into a single item', () => {
    const lines: OcrLine[] = [
      { text: 'Spiriva Respimat', frame: { x: 120, y: 40, width: 140, height: 16 } },
      { text: '2.5 mcg/puff 80 puff/bottle', frame: { x: 122, y: 58, width: 180, height: 16 } },
    ];

    expect(groupMedicationLinesIntoItems(lines)).toEqual([
      expect.objectContaining({
        text: 'Spiriva Respimat 2.5 mcg/puff 80 puff/bottle',
        frame: { x: 120, y: 40, width: 182, height: 34 },
      }),
    ]);
  });

  test('does not merge a section header into a medication group', () => {
    const lines: OcrLine[] = [
      { text: 'Spiriva Respimat 2.5mcg/puff', frame: { x: 120, y: 40, width: 170, height: 16 } },
      { text: '用法', frame: { x: 120, y: 58, width: 40, height: 16 } },
    ];

    const result = groupMedicationLinesIntoItems(lines);

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Spiriva Respimat 2.5mcg/puff');
  });

  test('does not merge lines from different columns', () => {
    const lines: OcrLine[] = [
      { text: 'Spiriva Respimat', frame: { x: 120, y: 40, width: 140, height: 16 } },
      { text: '2.5 mcg/puff', frame: { x: 280, y: 58, width: 100, height: 16 } },
    ];

    expect(groupMedicationLinesIntoItems(lines)).toHaveLength(2);
  });

  test('merges realistic misaligned Spiriva lines and drops quantity labels', () => {
    const lines: OcrLine[] = [
      { text: 'Spiriva Respimat 2.5mcg/puff, 總量1盒', frame: { x: 96, y: 40, width: 220, height: 16 } },
      { text: 'Kedication 60puff/bot(tiotropium)', frame: { x: 165, y: 71, width: 205, height: 16 } },
      { text: '適喘樂舒噴吸入劑', frame: { x: 142, y: 101, width: 150, height: 16 } },
      { text: 'Quantity', frame: { x: 330, y: 42, width: 58, height: 14 } },
      { text: '總量', frame: { x: 338, y: 62, width: 32, height: 14 } },
    ];

    const result = groupMedicationLinesIntoItems(lines);

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('Spiriva Respimat 2.5mcg/puff');
    expect(result[0]?.text).toContain('Kedication 60puff/bot(tiotropium)');
    expect(result[0]?.text).toContain('適喘樂舒噴吸入劑');
    expect(result[0]?.text).not.toContain('Quantity');
    expect(result[0]?.text).not.toContain('總量1盒');
    expect(result[0]?.text).not.toBe('總量');
  });

  test('drops medication meta lines and does not merge them into the medication block', () => {
    const lines: OcrLine[] = [
      { text: 'Spiriva Respimat 2.5mcg/puff', frame: { x: 96, y: 40, width: 180, height: 16 } },
      { text: '適喘樂舒噴吸入劑', frame: { x: 120, y: 66, width: 140, height: 16 } },
      { text: '外用', frame: { x: 120, y: 90, width: 30, height: 16 } },
      { text: '藥品資訊連結', frame: { x: 124, y: 112, width: 90, height: 16 } },
    ];

    const result = groupMedicationLinesIntoItems(lines);

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe('Spiriva Respimat 2.5mcg/puff 適喘樂舒噴吸入劑');
    expect(result[0]?.text).not.toContain('外用');
    expect(result[0]?.text).not.toContain('藥品資訊連結');
  });

  test('strips inline medication header prefixes and keeps the medication content', () => {
    const result = analyzeMedicationLineGrouping([
      { text: 'Spiriva Respimat 2.5mcg/puff,總量1盒', frame: { x: 96, y: 40, width: 220, height: 16 } },
      { text: 'Medication 60puff/bot(tiotropium)', frame: { x: 165, y: 71, width: 205, height: 16 } },
      { text: '適喘樂舒噴吸入劑', frame: { x: 142, y: 101, width: 150, height: 16 } },
    ]);

    expect(result.candidateLines.map((line) => line.text)).toContain('60puff/bot(tiotropium)');
    expect(result.candidateLines.map((line) => line.text)).not.toContain('Medication 60puff/bot(tiotropium)');
  });

  test('drops a medication header line when it has no trailing content', () => {
    const result = analyzeMedicationLineGrouping([
      { text: 'Medication', frame: { x: 96, y: 40, width: 80, height: 16 } },
      { text: 'Spiriva Respimat 2.5mcg/puff', frame: { x: 96, y: 66, width: 220, height: 16 } },
    ]);

    expect(result.candidateLines.map((line) => line.text)).toEqual(['Spiriva Respimat 2.5mcg/puff']);
  });

  test('keeps dosage details while stripping trailing quantity phrases from grouped output', () => {
    const result = groupMedicationLinesIntoItems([
      { text: 'Spiriva Respimat 2.5mcg/puff,總量1盒', frame: { x: 96, y: 40, width: 220, height: 16 } },
      { text: 'Medication 60puff/bot(tiotropium)', frame: { x: 165, y: 71, width: 205, height: 16 } },
    ]);

    expect(result[0]?.text).toContain('2.5mcg/puff');
    expect(result[0]?.text).toContain('60puff/bot(tiotropium)');
    expect(result[0]?.text).not.toContain('總量1盒');
  });

  test('strips OCR-typo trailing quantity like 總量1会 and 總量1金', () => {
    const result = groupMedicationLinesIntoItems([
      { text: 'Spiriva Respimat 2.5mcg/puff,總量1会', frame: { x: 96, y: 40, width: 220, height: 16 } },
    ]);

    expect(result[0]?.text).toContain('Spiriva Respimat 2.5mcg/puff');
    expect(result[0]?.text).not.toContain('總量1会');

    const result2 = groupMedicationLinesIntoItems([
      { text: 'Spiriva Respimat 2.5mcg/puff,總量1金', frame: { x: 96, y: 40, width: 220, height: 16 } },
    ]);

    expect(result2[0]?.text).toContain('Spiriva Respimat 2.5mcg/puff');
    expect(result2[0]?.text).not.toContain('總量1金');
  });

  test('does not strip internal dosage tokens when cleaning quantity', () => {
    const result = groupMedicationLinesIntoItems([
      { text: 'Spiriva Respimat 2.5mcg/puff,總量1会', frame: { x: 96, y: 40, width: 220, height: 16 } },
    ]);

    expect(result[0]?.text).toContain('2.5mcg/puff');
    expect(result[0]?.text).not.toContain('總量');
  });

  test('merges left-column inline Medication row into nearest right-column group by Y-proximity', () => {
    const lines: OcrLine[] = [
      {
        text: 'Spiriva Respimat 2.5mcg/puff',
        frame: { x: 116, y: 168, width: 368, height: 20 },
      },
      {
        text: 'Medication 60puff/bot(tiotropium)',
        frame: { x: 40, y: 188, width: 266, height: 16 },
      },
      {
        text: '適喘樂舒噴吸入劑',
        frame: { x: 124, y: 203, width: 132, height: 17 },
      },
    ];

    const result = groupMedicationLinesIntoItems(lines);

    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('Spiriva');
    expect(result[0]?.text).toContain('60puff/bot(tiotropium)');
    expect(result[0]?.text).toContain('適喘樂舒噴吸入劑');
  });

  test('does not attach left-column inline line when Y-distance is too far', () => {
    const lines: OcrLine[] = [
      {
        text: 'Spiriva Respimat 2.5mcg/puff',
        frame: { x: 116, y: 168, width: 368, height: 20 },
      },
      {
        text: 'Medication 60puff/bot(tiotropium)',
        frame: { x: 40, y: 320, width: 266, height: 16 },
      },
    ];

    const result = groupMedicationLinesIntoItems(lines);

    expect(result).toHaveLength(2);
    expect(result[0]?.text).toContain('Spiriva');
    expect(result[1]?.text).toContain('60puff/bot(tiotropium)');
  });
});
