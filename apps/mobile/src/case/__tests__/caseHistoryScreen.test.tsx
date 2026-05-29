import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import '../../lib/i18n';
import { CaseHistoryScreen } from '../CaseHistoryScreen';

jest.mock('../../api/case', () => ({
  listCases: jest.fn().mockResolvedValue([
    {
      caseId: 'case-1',
      caseType: 'medicine_bag',
      createdAt: '2026-05-21T10:00:00.000Z',
      detectedItemCount: 2,
      firstPhotoUrl: 'https://example.com/photo-1.jpg',
      firstThumbUrl: null,
      ocrPreview: 'AMOXICILLIN 500 MG CAPSULE',
    },
    {
      caseId: 'case-2',
      caseType: 'brand_package',
      createdAt: '2026-05-20T08:30:00.000Z',
      detectedItemCount: 1,
      firstPhotoUrl: null,
      firstThumbUrl: null,
      ocrPreview: 'METFORMIN 500 MG TABLET',
    },
  ]),
}), { virtual: true });

describe('CaseHistoryScreen', () => {
  test('renders case history cards from the API', async () => {
    const screen = render(
      <CaseHistoryScreen
        navigation={{ navigate: jest.fn() } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('AMOXICILLIN 500 MG CAPSULE')).toBeTruthy();
    });

    expect(screen.getByText('METFORMIN 500 MG TABLET')).toBeTruthy();
    expect(screen.getByText('2 detected item(s)')).toBeTruthy();
  });
});
