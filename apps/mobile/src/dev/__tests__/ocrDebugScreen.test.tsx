import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import '../../lib/i18n';

const mockListCases = jest.fn();
const mockGetCase = jest.fn();

jest.mock('../../api/case', () => ({
  listCases: (...args: unknown[]) => mockListCases(...args),
  getCase: (...args: unknown[]) => mockGetCase(...args),
}), { virtual: true });

import { OcrDebugScreen } from '../OcrDebugScreen';

import type { CaseRecord } from '../../types/case';
import type { RemoteOcrResult } from '../../ocr/types';
import { mapBboxContain } from '../OcrDebugScreen';

const makeRemoteModel = (): RemoteOcrResult => ({
  engine: 'PaddleOCR',
  version: 'PP-StructureV3',
  pages: [
    {
      width: 1000,
      height: 800,
      elements: [
        { type: 'text', text: 'Paracetamol 500mg', bbox: [50, 40, 300, 70], confidence: 0.99 },
        { type: 'text', text: 'Ibuprofen 400mg', bbox: [50, 120, 280, 150], confidence: 0.45 },
        { type: 'text', text: 'Aspirin 100mg', bbox: [50, 200, 260, 230], confidence: 0.95 },
      ],
    },
  ],
});

const makeCaseRecord = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
  caseId: 'case-1',
  caseType: 'medicine_bag',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ocrRawText: '',
  ocrSections: {
    medicationLines: [],
    instructionLines: [],
    indicationsLines: [],
    warningsLines: [],
    sideEffectsLines: [],
    dispensingDateLines: [],
    quantityLines: [],
    pharmacistLines: [],
    caseFields: null,
    remoteModel: makeRemoteModel(),
  },
  detectedItems: [],
  photoPaths: [],
  photoUrls: ['https://example.com/photo.jpg'],
  thumbUrls: [],
  ingredientIds: [],
  shareToAllCareTeams: false,
  ...overrides,
});

describe('mapBboxContain', () => {
  test('scales by width when image is wider than view', () => {
    const bbox = [0, 0, 200, 100];

    const result = mapBboxContain(bbox, 400, 200, 200, 200);

    const scale = 200 / 400;
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo((200 - 200 * scale) / 2);
    expect(result.w).toBeCloseTo(200 * scale);
    expect(result.h).toBeCloseTo(100 * scale);
  });

  test('scales by height when image is taller than view', () => {
    const bbox = [0, 0, 100, 200];

    const result = mapBboxContain(bbox, 200, 400, 200, 200);

    const scale = 200 / 400;
    expect(result.x).toBeCloseTo((200 - 200 * scale) / 2);
    expect(result.y).toBeCloseTo(0);
    expect(result.w).toBeCloseTo(100 * scale);
    expect(result.h).toBeCloseTo(200 * scale);
  });

  test('maps bbox at origin correctly', () => {
    const result = mapBboxContain([0, 0, 100, 50], 200, 100, 200, 100);

    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.w).toBeCloseTo(100);
    expect(result.h).toBeCloseTo(50);
  });

  test('maps bbox not at origin correctly', () => {
    const bbox = [50, 30, 150, 80];
    const imgW = 200;
    const imgH = 100;
    const viewW = 200;
    const viewH = 100;
    const scale = 1;

    const result = mapBboxContain(bbox, imgW, imgH, viewW, viewH);

    expect(result.x).toBeCloseTo(50 * scale);
    expect(result.y).toBeCloseTo(30 * scale);
    expect(result.w).toBeCloseTo(100 * scale);
    expect(result.h).toBeCloseTo(50 * scale);
  });

  test('handles landscape image in square viewport', () => {
    const bbox = [100, 50, 300, 150];
    const imgW = 400;
    const imgH = 200;
    const viewW = 300;
    const viewH = 300;

    const scale = 300 / 400;
    const offsetY = (300 - 200 * scale) / 2;

    const result = mapBboxContain(bbox, imgW, imgH, viewW, viewH);

    expect(result.x).toBeCloseTo(100 * scale);
    expect(result.y).toBeCloseTo(50 * scale + offsetY);
    expect(result.w).toBeCloseTo(200 * scale);
    expect(result.h).toBeCloseTo(100 * scale);
  });

  test('handles portrait image in square viewport', () => {
    const bbox = [50, 100, 150, 300];
    const imgW = 200;
    const imgH = 400;
    const viewW = 300;
    const viewH = 300;

    const scale = 300 / 400;
    const offsetX = (300 - 200 * scale) / 2;

    const result = mapBboxContain(bbox, imgW, imgH, viewW, viewH);

    expect(result.x).toBeCloseTo(50 * scale + offsetX);
    expect(result.y).toBeCloseTo(100 * scale);
    expect(result.w).toBeCloseTo(100 * scale);
    expect(result.h).toBeCloseTo(200 * scale);
  });

  test('produces minimum width and height of 1 for zero-size boxes', () => {
    const bbox = [10, 10, 10, 10];

    const result = mapBboxContain(bbox, 100, 100, 100, 100);

    expect(result.w).toBe(1);
    expect(result.h).toBe(1);
  });

  test('matches real-world PaddleOCR remote model page dimensions', () => {
    const bbox = [100, 200, 500, 250];
    const imgW = 3072;
    const imgH = 4096;
    const viewW = 375;
    const viewH = 500;

    const scale = Math.min(375 / 3072, 500 / 4096);
    const offsetX = (375 - 3072 * scale) / 2;
    const offsetY = (500 - 4096 * scale) / 2;

    const result = mapBboxContain(bbox, imgW, imgH, viewW, viewH);

    expect(result.x).toBeCloseTo(100 * scale + offsetX);
    expect(result.y).toBeCloseTo(200 * scale + offsetY);
    expect(result.w).toBeCloseTo(400 * scale);
    expect(result.h).toBeCloseTo(50 * scale);
  });
});

describe('OcrDebugScreen', () => {
  beforeEach(() => {
    mockListCases.mockReset();
    mockGetCase.mockReset();
  });

  test('renders OCR texts from remote model data with default >= 0.5 filter', async () => {
    mockListCases.mockResolvedValue([
      { caseId: 'case-1', caseType: 'medicine_bag', createdAt: '2026-01-01T00:00:00Z', firstPhotoUrl: null, firstThumbUrl: null, ocrPreview: '', detectedItemCount: 0 },
    ]);
    mockGetCase.mockResolvedValue(makeCaseRecord());

    const screen = render(<OcrDebugScreen onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    });

    expect(screen.getByText('Aspirin 100mg')).toBeTruthy();
    expect(screen.queryByText('Ibuprofen 400mg')).toBeNull();
  });

  test('hides low-confidence items when filtering at >= 0.8', async () => {
    mockListCases.mockResolvedValue([
      { caseId: 'case-1', caseType: 'medicine_bag', createdAt: '2026-01-01T00:00:00Z', firstPhotoUrl: null, firstThumbUrl: null, ocrPreview: '', detectedItemCount: 0 },
    ]);
    mockGetCase.mockResolvedValue(makeCaseRecord());

    const screen = render(<OcrDebugScreen onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('All'));

    expect(screen.getByText('Ibuprofen 400mg')).toBeTruthy();

    fireEvent.press(screen.getByText('≥ 0.8'));

    expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    expect(screen.getByText('Aspirin 100mg')).toBeTruthy();
    expect(screen.queryByText('Ibuprofen 400mg')).toBeNull();
  });

  test('shows all items when switching from >= 0.8 to All', async () => {
    mockListCases.mockResolvedValue([
      { caseId: 'case-1', caseType: 'medicine_bag', createdAt: '2026-01-01T00:00:00Z', firstPhotoUrl: null, firstThumbUrl: null, ocrPreview: '', detectedItemCount: 0 },
    ]);
    mockGetCase.mockResolvedValue(makeCaseRecord());

    const screen = render(<OcrDebugScreen onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('≥ 0.8'));

    expect(screen.queryByText('Ibuprofen 400mg')).toBeNull();

    fireEvent.press(screen.getByText('All'));

    expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    expect(screen.getByText('Ibuprofen 400mg')).toBeTruthy();
    expect(screen.getByText('Aspirin 100mg')).toBeTruthy();
  });

  test('filters elements by search text', async () => {
    mockListCases.mockResolvedValue([
      { caseId: 'case-1', caseType: 'medicine_bag', createdAt: '2026-01-01T00:00:00Z', firstPhotoUrl: null, firstThumbUrl: null, ocrPreview: '', detectedItemCount: 0 },
    ]);
    mockGetCase.mockResolvedValue(makeCaseRecord());

    const screen = render(<OcrDebugScreen onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search text...');
    fireEvent.changeText(searchInput, 'Aspirin');

    expect(screen.getByText('Aspirin 100mg')).toBeTruthy();
    expect(screen.queryByText('Paracetamol 500mg')).toBeNull();
    expect(screen.queryByText('Ibuprofen 400mg')).toBeNull();
  });

  test('shows error when no cases exist', async () => {
    mockListCases.mockResolvedValue([]);

    const screen = render(<OcrDebugScreen onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No cases found. Create a case first.')).toBeTruthy();
    });
  });

  test('shows error when case has no remote model data', async () => {
    mockListCases.mockResolvedValue([
      { caseId: 'case-1', caseType: 'medicine_bag', createdAt: '2026-01-01T00:00:00Z', firstPhotoUrl: null, firstThumbUrl: null, ocrPreview: '', detectedItemCount: 0 },
    ]);
    mockGetCase.mockResolvedValue(makeCaseRecord({
      ocrSections: {
        medicationLines: [],
        instructionLines: [],
        indicationsLines: [],
        warningsLines: [],
        sideEffectsLines: [],
        dispensingDateLines: [],
        quantityLines: [],
        pharmacistLines: [],
        caseFields: null,
        remoteModel: null,
      },
    }));

    const screen = render(<OcrDebugScreen onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No remote model data found in this case.')).toBeTruthy();
    });
  });

  test('displays engine version and count summary', async () => {
    mockListCases.mockResolvedValue([
      { caseId: 'case-1', caseType: 'medicine_bag', createdAt: '2026-01-01T00:00:00Z', firstPhotoUrl: null, firstThumbUrl: null, ocrPreview: '', detectedItemCount: 0 },
    ]);
    mockGetCase.mockResolvedValue(makeCaseRecord());

    const screen = render(<OcrDebugScreen onBack={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    });

    expect(screen.getByText(/PaddleOCR/)).toBeTruthy();
    expect(screen.getByText(/1000/)).toBeTruthy();
    expect(screen.getByText(/800/)).toBeTruthy();
  });
});
