import type { OcrLine } from './types';

const ROW_TOLERANCE_PX = 10;

export function sortLinesReadingOrder(lines: OcrLine[]): OcrLine[] {
  return [...lines].sort((a, b) => {
    const dy = a.frame.y - b.frame.y;
    if (Math.abs(dy) > ROW_TOLERANCE_PX) {
      return dy;
    }
    return a.frame.x - b.frame.x;
  });
}
