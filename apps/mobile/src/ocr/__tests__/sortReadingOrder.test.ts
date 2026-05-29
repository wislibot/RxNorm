import { sortLinesReadingOrder } from '../sortReadingOrder';
import type { OcrLine } from '../types';

describe('sortLinesReadingOrder', () => {
  test('sorts lines by y first, then x within the row tolerance', () => {
    const lines: OcrLine[] = [
      { text: 'line-3', frame: { x: 160, y: 62, width: 40, height: 16 } },
      { text: 'line-2', frame: { x: 120, y: 58, width: 40, height: 16 } },
      { text: 'line-4', frame: { x: 80, y: 95, width: 40, height: 16 } },
      { text: 'line-1', frame: { x: 20, y: 20, width: 40, height: 16 } },
    ];

    expect(sortLinesReadingOrder(lines).map((line) => line.text)).toEqual(['line-1', 'line-2', 'line-3', 'line-4']);
  });
});
