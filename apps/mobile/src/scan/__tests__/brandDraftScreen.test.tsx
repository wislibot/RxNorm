import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import '../../lib/i18n';
import { BrandDraftScreen } from '../BrandDraftScreen';

const mockRunOcrOnImages = jest.fn();

class MockOcrUnavailableError extends Error {
  constructor(message = 'OCR module not available') {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

jest.mock('../../ocr/ocr', () => ({
  runOcrOnImages: (...args: unknown[]) => mockRunOcrOnImages(...args),
  OcrUnavailableError: MockOcrUnavailableError,
  isOcrUnavailableError: (error: unknown) => error instanceof MockOcrUnavailableError,
}), { virtual: true });

describe('BrandDraftScreen', () => {
  beforeEach(() => {
    mockRunOcrOnImages.mockReset();
  });

  test('shows server unavailable message when OCR is unreachable', async () => {
    mockRunOcrOnImages.mockRejectedValue(new MockOcrUnavailableError('OCR server unavailable'));

    const screen = render(
      <BrandDraftScreen
        route={
          {
            key: 'BrandDraft',
            name: 'BrandDraft',
            params: {
              photo: { id: '1', uri: 'file://photo-1.jpg' },
            },
          } as never
        }
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByText('Run OCR'));
    });

    expect(
      screen.getByText('OCR server unavailable. Please try again later.'),
    ).toBeTruthy();
  });
});
