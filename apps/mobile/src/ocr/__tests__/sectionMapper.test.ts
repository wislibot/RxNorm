import type { OcrResult } from '../types';
import { mapOcrSections } from '../sectionMapper';

describe('mapOcrSections', () => {
  test('assigns framed medication lines to the medication section and keeps footer noise out', () => {
    const ocrResult: OcrResult = {
      text: '藥名\nAMOXICILLIN 500 MG CAPSULE\nMETFORMIN 500 MG TAB\n用法\n飯後服用\n總量\n3盒\n調劑藥師\n王大明\n(06)2677282',
      blocks: [
        {
          text: '藥名',
          frame: { x: 20, y: 40, width: 50, height: 16 },
          lines: [
            {
              text: '藥名',
              frame: { x: 20, y: 40, width: 50, height: 16 },
            },
          ],
        },
        {
          text: 'AMOXICILLIN 500 MG CAPSULE\nMETFORMIN 500 MG TAB',
          frame: { x: 120, y: 42, width: 180, height: 40 },
          lines: [
            {
              text: 'AMOXICILLIN 500 MG CAPSULE',
              frame: { x: 120, y: 42, width: 180, height: 16 },
            },
            {
              text: 'METFORMIN 500 MG TAB',
              frame: { x: 120, y: 64, width: 160, height: 16 },
            },
          ],
        },
        {
          text: '用法',
          frame: { x: 20, y: 120, width: 50, height: 16 },
          lines: [
            {
              text: '用法',
              frame: { x: 20, y: 120, width: 50, height: 16 },
            },
          ],
        },
        {
          text: '飯後服用',
          frame: { x: 120, y: 122, width: 80, height: 16 },
          lines: [
            {
              text: '飯後服用',
              frame: { x: 120, y: 122, width: 80, height: 16 },
            },
          ],
        },
        {
          text: '總量',
          frame: { x: 20, y: 160, width: 50, height: 16 },
          lines: [
            {
              text: '總量',
              frame: { x: 20, y: 160, width: 50, height: 16 },
            },
          ],
        },
        {
          text: '3盒',
          frame: { x: 120, y: 162, width: 60, height: 16 },
          lines: [
            {
              text: '3盒',
              frame: { x: 120, y: 162, width: 60, height: 16 },
            },
          ],
        },
        {
          text: '調劑藥師',
          frame: { x: 20, y: 200, width: 80, height: 16 },
          lines: [
            {
              text: '調劑藥師',
              frame: { x: 20, y: 200, width: 80, height: 16 },
            },
          ],
        },
        {
          text: '王大明',
          frame: { x: 120, y: 202, width: 60, height: 16 },
          lines: [
            {
              text: '王大明',
              frame: { x: 120, y: 202, width: 60, height: 16 },
            },
          ],
        },
        {
          text: '(06)2677282',
          frame: { x: 18, y: 250, width: 90, height: 16 },
          lines: [
            {
              text: '(06)2677282',
              frame: { x: 18, y: 250, width: 90, height: 16 },
            },
          ],
        },
      ],
    };

    const result = mapOcrSections(ocrResult);

    expect(result.sections.medication.texts).toEqual([
      'AMOXICILLIN 500 MG CAPSULE',
      'METFORMIN 500 MG TAB',
    ]);
    expect(result.sections.medication.lines).toEqual([
      {
        text: 'AMOXICILLIN 500 MG CAPSULE',
        frame: { x: 120, y: 42, width: 180, height: 16 },
      },
      {
        text: 'METFORMIN 500 MG TAB',
        frame: { x: 120, y: 64, width: 160, height: 16 },
      },
    ]);
    expect(result.sections.medication.texts).not.toContain('(06)2677282');
    expect(result.sections.instruction.texts).toEqual(['飯後服用']);
    expect(result.sections.quantity.texts).toEqual(['3盒']);
    expect(result.sections.pharmacist.texts).toEqual(['王大明']);
    expect(result.sections.unassigned.texts).toContain('(06)2677282');
  });

  test('includes inline medication value rows even when they sit in the left column', () => {
    const ocrResult: OcrResult = {
      text: '藥名\nSpiriva Respimat 2.5mcg/puff,總量1盒\nMedication 60puff/bot(tiotropium)\n用法',
      blocks: [
        {
          text: '藥名',
          frame: { x: 18, y: 40, width: 50, height: 16 },
          lines: [{ text: '藥名', frame: { x: 18, y: 40, width: 50, height: 16 } }],
        },
        {
          text: 'Spiriva Respimat 2.5mcg/puff,總量1盒',
          frame: { x: 116, y: 42, width: 210, height: 16 },
          lines: [{ text: 'Spiriva Respimat 2.5mcg/puff,總量1盒', frame: { x: 116, y: 42, width: 210, height: 16 } }],
        },
        {
          text: 'Medication 60puff/bot(tiotropium)',
          frame: { x: 40, y: 66, width: 220, height: 16 },
          lines: [{ text: 'Medication 60puff/bot(tiotropium)', frame: { x: 40, y: 66, width: 220, height: 16 } }],
        },
        {
          text: '用法',
          frame: { x: 18, y: 120, width: 50, height: 16 },
          lines: [{ text: '用法', frame: { x: 18, y: 120, width: 50, height: 16 } }],
        },
      ],
    };

    const result = mapOcrSections(ocrResult);

    expect(result.sections.medication.texts).toContain('Spiriva Respimat 2.5mcg/puff,總量1盒');
    expect(result.sections.medication.texts).toContain('Medication 60puff/bot(tiotropium)');
  });

  test('handles OCR spacing typos in inline medication rows and anchor detection', () => {
    const ocrResult: OcrResult = {
      text: '藥名\nSpiriva Respimat 2.5mcg/puff\nMedi cation 60puff/bot(tiotropium)\nIndicati ons\nCOPD maintenance',
      blocks: [
        {
          text: '藥名',
          frame: { x: 18, y: 40, width: 50, height: 16 },
          lines: [{ text: '藥名', frame: { x: 18, y: 40, width: 50, height: 16 } }],
        },
        {
          text: 'Spiriva Respimat 2.5mcg/puff',
          frame: { x: 116, y: 42, width: 210, height: 16 },
          lines: [{ text: 'Spiriva Respimat 2.5mcg/puff', frame: { x: 116, y: 42, width: 210, height: 16 } }],
        },
        {
          text: 'Medi cation 60puff/bot(tiotropium)',
          frame: { x: 40, y: 66, width: 220, height: 16 },
          lines: [{ text: 'Medi cation 60puff/bot(tiotropium)', frame: { x: 40, y: 66, width: 220, height: 16 } }],
        },
        {
          text: 'Indicati ons',
          frame: { x: 18, y: 120, width: 80, height: 16 },
          lines: [{ text: 'Indicati ons', frame: { x: 18, y: 120, width: 80, height: 16 } }],
        },
        {
          text: 'COPD maintenance',
          frame: { x: 116, y: 122, width: 120, height: 16 },
          lines: [{ text: 'COPD maintenance', frame: { x: 116, y: 122, width: 120, height: 16 } }],
        },
      ],
    };

    const result = mapOcrSections(ocrResult);

    expect(result.sections.medication.texts).toContain('Medi cation 60puff/bot(tiotropium)');
    expect(result.sections.medication.texts).toContain('Spiriva Respimat 2.5mcg/puff');
    expect(result.sections.indications.texts).toContain('COPD maintenance');
  });
});
