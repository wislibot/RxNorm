import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import '../../lib/i18n';
import { CasePageScreen } from '../CasePageScreen';

jest.mock('../../api/case', () => ({
  getCase: jest.fn().mockResolvedValue({
    caseId: 'case-123',
    caseType: 'medicine_bag',
    createdAt: '2026-05-21T10:00:00.000Z',
    detectedItems: [
      {
        confidence: 0.9,
        displayName: 'Spiriva Respimat 2.5mcg/puff',
        ingredientId: 'ing-tiotropium',
        matchMethod: 'paren_alias_exact',
        matchStatus: 'matched',
        note: null,
        rawText: 'Spiriva Respimat 2.5mcg/puff',
        source: 'ocr_line',
      },
      {
        confidence: null,
        displayName: '60puff/bot(tiotropium)',
        matchStatus: 'unmatched',
        note: null,
        rawText: '60puff/bot(tiotropium)',
        source: 'ocr_line',
      },
      {
        confidence: null,
        displayName: '適喘樂舒噴吸入劑',
        matchStatus: 'unmatched',
        note: null,
        rawText: '適喘樂舒噴吸入劑',
        source: 'ocr_line',
      },
      {
        confidence: null,
        displayName: '藥品資訊連結',
        matchStatus: 'unmatched',
        note: null,
        rawText: '藥品資訊連結',
        source: 'ocr_line',
      },
    ],
    ingredientIds: ['ing-tiotropium'],
    ocrRawText: 'Spiriva Respimat 2.5mcg/puff\n60puff/bot(tiotropium)\n適喘樂舒噴吸入劑',
    ocrSections: {
      caseFields: {
        directions: null,
        dispensingDate: '2026-05-25',
        indications: ['COPD maintenance'],
        patientName: '陳小明',
        patientSex: 'M',
        pharmacistName: '王大明',
        pharmacyAddress: '台北市內湖區成功路二段325號',
        pharmacyName: '內湖總院',
        quantity: '1盒',
        sideEffects: ['Dry mouth, dizziness'],
        warnings: ['Avoid alcohol while taking'],
        brandNames: ['適喘樂舒沛噴吸入劑 2.5 微公克 (Spiriva Respimat 2.5mcg, Solution for Inhalation)'],
      },
      dispensingDateLines: ['2026/05/25'],
      indicationsLines: ['COPD maintenance'],
      instructionLines: ['Take after meals', 'Once daily', 'Indications'],
      medicationLines: ['Spiriva Respimat 2.5mcg/puff', '60puff/bot(tiotropium)', '適喘樂舒噴吸入劑', '藥品資訊連結'],
      pharmacistLines: ['王大明'],
      quantityLines: ['1盒'],
      sideEffectsLines: ['Dry mouth, dizziness'],
      warningsLines: ['Avoid alcohol while taking'],
    },
    photoPaths: ['user/case/0.jpg'],
    photoUrls: ['https://example.com/photo.jpg'],
    thumbUrls: [],
    shareToAllCareTeams: true,
    updatedAt: '2026-05-21T10:00:00.000Z',
  }),
  getMockAutoShareStatus: jest.fn().mockResolvedValue({
    sharedCareTeamCount: 2,
    isAutoShareDefault: true,
  }),
}), { virtual: true });

jest.mock('../../api/ddi', () => ({
  getCaseDdiByIngredients: jest.fn().mockResolvedValue({
    checked_ingredient_count: 1,
    unchecked_ingredient_count: 2,
    checked_ingredients: [
      { canonical_name: 'TIOTROPIUM', ingredient_id: 'ing-tiotropium' },
    ],
    coverage_disclaimer_en:
      'DDI screening coverage is limited to medicines in the Taiwan curated dictionary. If some medicines could not be checked, confirm with a clinician/pharmacist.',
    interactions: [],
    interactions_found_count: 0,
    unchecked_items: [],
  }),
}), { virtual: true });

describe('CasePageScreen', () => {
  test('renders a single grouped medication card for a single-med bag', async () => {
    const screen = render(
      <CasePageScreen
        route={
          {
            key: 'CasePage',
            name: 'CasePage',
            params: {
              caseId: 'case-123',
            },
          } as never
        }
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('60puff/bot(tiotropium)')).toBeTruthy();
    });

    expect(screen.getByText('Matched')).toBeTruthy();
    expect(screen.getByText('Other extracted text')).toBeTruthy();
    expect(screen.getByText('藥品資訊連結')).toBeTruthy();
    expect(screen.getByText('適喘樂舒噴吸入劑')).toBeTruthy();
    expect(screen.getByText('Instruction')).toBeTruthy();
    expect(screen.getByText('Take after meals\nOnce daily')).toBeTruthy();
    expect(screen.getByText('Case Summary')).toBeTruthy();
    expect(screen.getByText('陳小明')).toBeTruthy();
    expect(screen.getByText('Male')).toBeTruthy();
    expect(screen.getByText('1盒')).toBeTruthy();
    expect(screen.getByText('2026-05-25')).toBeTruthy();
    expect(screen.getByText('內湖總院')).toBeTruthy();
    expect(screen.getByText('王大明')).toBeTruthy();
    expect(screen.getByText('適喘樂舒沛噴吸入劑 2.5 微公克 (Spiriva Respimat 2.5mcg, Solutionfor Inhalation)')).toBeTruthy();
    expect(screen.getByText('Some medicines could not be checked for interactions.')).toBeTruthy();
    expect(
      screen.getByText(
        'DDI screening coverage is limited to medicines in the Taiwan curated dictionary. If some medicines could not be checked, confirm with a clinician/pharmacist.',
      ),
    ).toBeTruthy();
  });

  test('shows unmatched group separately when multiple matched meds exist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCase } = require('../../api/case');
    getCase.mockResolvedValueOnce({
      caseId: 'case-456',
      caseType: 'medicine_bag',
      createdAt: '2026-05-21T10:00:00.000Z',
      detectedItems: [
        {
          confidence: 0.95,
          displayName: 'AMOXICILLIN 500 MG CAPSULE',
          ingredientId: 'ing-amoxicillin',
          matchMethod: 'canonical_exact',
          matchStatus: 'matched',
          note: null,
          rawText: 'AMOXICILLIN 500 MG CAPSULE',
          source: 'ocr_line',
        },
        {
          confidence: 0.95,
          displayName: 'CLARITHROMYCIN 250 MG TABLET',
          ingredientId: 'ing-clarithromycin',
          matchMethod: 'canonical_exact',
          matchStatus: 'matched',
          note: null,
          rawText: 'CLARITHROMYCIN 250 MG TABLET',
          source: 'ocr_line',
        },
        {
          confidence: null,
          displayName: 'Unknown pink tablet',
          matchStatus: 'unmatched',
          note: null,
          rawText: 'Unknown pink tablet',
          source: 'ocr_line',
        },
      ],
      ingredientIds: ['ing-amoxicillin', 'ing-clarithromycin'],
      ocrRawText: 'AMOXICILLIN 500 MG CAPSULE\nCLARITHROMYCIN 250 MG TABLET\nUnknown pink tablet',
      ocrSections: {
        instructionLines: [],
        medicationLines: [],
      },
      photoPaths: [],
      photoUrls: [],
      thumbUrls: [],
      shareToAllCareTeams: true,
      updatedAt: '2026-05-21T10:00:00.000Z',
    });

    const screen = render(
      <CasePageScreen
        route={
          {
            key: 'CasePage',
            name: 'CasePage',
            params: {
              caseId: 'case-456',
            },
          } as never
        }
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('AMOXICILLIN 500 MG CAPSULE')).toBeTruthy();
    });

    expect(screen.getByText('CLARITHROMYCIN 250 MG TABLET')).toBeTruthy();
    expect(screen.getByText('Unmatched')).toBeTruthy();
    expect(screen.getByText('Unknownpink tablet')).toBeTruthy();
    expect(screen.getAllByText('Matched').length).toBe(2);
  });
});
