import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import '../../lib/i18n';
import { CaseDraftScreen } from '../CaseDraftScreen';

const mockCreateCase = jest.fn();
const mockRunOcrOnImagesStructured = jest.fn();
class MockOcrUnavailableError extends Error {
  constructor(message = 'OCR module not available') {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

jest.mock('../../api/case', () => ({
  createCase: (...args: unknown[]) => mockCreateCase(...args),
}), { virtual: true });

jest.mock('../../ocr/ocr', () => ({
  runOcrOnImagesStructured: (...args: unknown[]) => mockRunOcrOnImagesStructured(...args),
  OcrUnavailableError: MockOcrUnavailableError,
  isOcrUnavailableError: (error: unknown) => error instanceof MockOcrUnavailableError,
}), { virtual: true });

jest.mock('../../ocr/sectionMapper', () => ({
  mapOcrSections: jest.fn().mockReturnValue({
    sections: {
      medication: {
        lines: [{ text: 'LINE 1', frame: { x: 120, y: 42, width: 180, height: 16 } }],
        texts: ['LINE 1'],
      },
      instruction: { lines: [], texts: [] },
      indications: { lines: [], texts: [] },
      warnings: { lines: [], texts: [] },
      side_effects: { lines: [], texts: [] },
      prescription_no: { lines: [], texts: [] },
      dispensing_date: { lines: [], texts: [] },
      unassigned: { lines: [], texts: [] },
    },
  }),
}), { virtual: true });

describe('CaseDraftScreen', () => {
  beforeEach(() => {
    mockCreateCase.mockReset();
    mockCreateCase.mockResolvedValue({ caseId: 'case-123' });
    mockRunOcrOnImagesStructured.mockReset();
    mockRunOcrOnImagesStructured.mockResolvedValue({ text: '', blocks: [] });
  });

  test('shows loading then renders OCR text after running recognition', async () => {
    let resolveOcr: ((value: { text: string; blocks: unknown[] }) => void) | undefined;
    mockRunOcrOnImagesStructured.mockImplementation(
      () =>
        new Promise<{ text: string; blocks: unknown[] }>((resolve) => {
          resolveOcr = resolve;
        }),
    );

    const navigation = {
      navigate: jest.fn(),
    };

    const screen = render(
      <CaseDraftScreen
        navigation={navigation as never}
        route={
          {
            key: 'CaseDraft',
            name: 'CaseDraft',
            params: {
              photos: [{ id: '1', uri: 'file://photo-1.jpg' }],
            },
          } as never
        }
      />,
    );

    fireEvent.press(screen.getByText('Run OCR'));
    expect(screen.getByText('Running OCR...')).toBeTruthy();

    await act(async () => {
      resolveOcr?.({ text: 'LINE 1\nLINE 2', blocks: [] });
    });

    expect(screen.getByText('LINE 1\nLINE 2')).toBeTruthy();
    expect(screen.getByText('Create case page')).toBeTruthy();
  });

  test('passes mapped framed sections into createCase after OCR succeeds', async () => {
    mockRunOcrOnImagesStructured.mockResolvedValue({
      text: 'LINE 1\nLINE 2',
      blocks: [{ text: 'LINE 1', frame: { x: 20, y: 20, width: 50, height: 16 }, lines: [] }],
    });

    const navigation = {
      navigate: jest.fn(),
    };

    const screen = render(
      <CaseDraftScreen
        navigation={navigation as never}
        route={
          {
            key: 'CaseDraft',
            name: 'CaseDraft',
            params: {
              photos: [{ id: '1', uri: 'file://photo-1.jpg' }],
            },
          } as never
        }
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByText('Run OCR'));
    });

    await act(async () => {
      fireEvent.press(screen.getByText('Create case page'));
    });

    expect(mockCreateCase).toHaveBeenCalledWith({
      caseType: 'medicine_bag',
      ingredientIds: [],
      ocrRawText: 'LINE 1\nLINE 2',
      photoUris: ['file://photo-1.jpg'],
      sectionedOcr: {
        sections: {
          medication: {
            lines: [{ text: 'LINE 1', frame: { x: 120, y: 42, width: 180, height: 16 } }],
            texts: ['LINE 1'],
          },
          instruction: { lines: [], texts: [] },
          indications: { lines: [], texts: [] },
          warnings: { lines: [], texts: [] },
          side_effects: { lines: [], texts: [] },
          prescription_no: { lines: [], texts: [] },
          dispensing_date: { lines: [], texts: [] },
          unassigned: { lines: [], texts: [] },
        },
      },
    });
    expect(navigation.navigate).toHaveBeenCalledWith('CasePage', { caseId: 'case-123' });
  });

  test('shows server unavailable message when OCR is unreachable', async () => {
    mockRunOcrOnImagesStructured.mockRejectedValue(new MockOcrUnavailableError('OCR server unavailable'));

    const navigation = {
      navigate: jest.fn(),
    };

    const screen = render(
      <CaseDraftScreen
        navigation={navigation as never}
        route={
          {
            key: 'CaseDraft',
            name: 'CaseDraft',
            params: {
              photos: [{ id: '1', uri: 'file://photo-1.jpg' }],
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

  test('shows not configured message when OCR server URL is missing', async () => {
    mockRunOcrOnImagesStructured.mockRejectedValue(new MockOcrUnavailableError('OCR server not configured'));

    const navigation = {
      navigate: jest.fn(),
    };

    const screen = render(
      <CaseDraftScreen
        navigation={navigation as never}
        route={
          {
            key: 'CaseDraft',
            name: 'CaseDraft',
            params: {
              photos: [{ id: '1', uri: 'file://photo-1.jpg' }],
            },
          } as never
        }
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByText('Run OCR'));
    });

    expect(
      screen.getByText('OCR server not configured.'),
    ).toBeTruthy();
  });

  test('only calls OCR once even when button is pressed twice quickly', async () => {
    mockRunOcrOnImagesStructured.mockResolvedValue({
      text: 'TEXT',
      blocks: [],
    });

    const navigation = {
      navigate: jest.fn(),
    };

    const screen = render(
      <CaseDraftScreen
        navigation={navigation as never}
        route={
          {
            key: 'CaseDraft',
            name: 'CaseDraft',
            params: {
              photos: [{ id: '1', uri: 'file://photo-1.jpg' }],
            },
          } as never
        }
      />,
    );

    const runOcrButton = screen.getByText('Run OCR');

    fireEvent.press(runOcrButton);
    fireEvent.press(runOcrButton);

    await act(async () => {});

    expect(mockRunOcrOnImagesStructured).toHaveBeenCalledTimes(1);
  });
});
