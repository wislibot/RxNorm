import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { sortLinesReadingOrder } from './sortReadingOrder';
import type { OcrBlock, OcrLine, OcrResult, RemoteCaseFields, RemoteOcrResult } from './types';
import type { CaseFields } from '../types/caseFields';

const OCR_SERVER_URL = process.env.EXPO_PUBLIC_OCR_SERVER_URL ?? '';
const OCR_SERVER_API_KEY = process.env.EXPO_PUBLIC_OCR_SERVER_API_KEY ?? '';

if (__DEV__) {
  console.log('OCR_SERVER_URL', OCR_SERVER_URL);
}

const DEMO_WEB_OCR_TEXT = `AMOXICILLIN 500 MG
TAKE THREE TIMES DAILY
AFTER MEALS
PATIENT NAME: CHEN`;

const DEMO_WEB_STRUCTURED_OCR: OcrResult = {
  text: `藥名
AMOXICILLIN 500 MG CAPSULE
METFORMIN 500 MG TAB
用法
TAKE THREE TIMES DAILY
(06)2677282`,
  blocks: [
    {
      text: '藥名',
      frame: { x: 20, y: 40, width: 50, height: 16 },
      lines: [{ text: '藥名', frame: { x: 20, y: 40, width: 50, height: 16 } }],
    },
    {
      text: 'AMOXICILLIN 500 MG CAPSULE\nMETFORMIN 500 MG TAB',
      frame: { x: 120, y: 42, width: 180, height: 40 },
      lines: [
        { text: 'AMOXICILLIN 500 MG CAPSULE', frame: { x: 120, y: 42, width: 180, height: 16 } },
        { text: 'METFORMIN 500 MG TAB', frame: { x: 120, y: 64, width: 160, height: 16 } },
      ],
    },
    {
      text: '用法',
      frame: { x: 20, y: 120, width: 50, height: 16 },
      lines: [{ text: '用法', frame: { x: 20, y: 120, width: 50, height: 16 } }],
    },
    {
      text: 'TAKE THREE TIMES DAILY',
      frame: { x: 120, y: 122, width: 160, height: 16 },
      lines: [{ text: 'TAKE THREE TIMES DAILY', frame: { x: 120, y: 122, width: 160, height: 16 } }],
    },
    {
      text: '(06)2677282',
      frame: { x: 18, y: 250, width: 90, height: 16 },
      lines: [{ text: '(06)2677282', frame: { x: 18, y: 250, width: 90, height: 16 } }],
    },
  ],
};

export class OcrUnavailableError extends Error {
  constructor(message = 'OCR module not available') {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

export function isOcrUnavailableError(error: unknown): boolean {
  return error instanceof OcrUnavailableError || (error instanceof Error && error.name === 'OcrUnavailableError');
}

function centerY(frame: { y: number; height: number }): number {
  return frame.y + frame.height / 2;
}

export function isQrCodeElement(line: OcrLine): boolean {
  const trimmed = line.text.trim();
  if (trimmed.length > 2) return false;

  const { width, height } = line.frame;
  if (width < 40 || height < 40) return false;

  const aspectRatio = width / height;
  if (aspectRatio < 0.7 || aspectRatio > 1.4) return false;

  return true;
}

function lineSort(a: OcrLine, b: OcrLine): number {
  const dy = a.frame.y - b.frame.y;
  if (Math.abs(dy) > 1) return dy;
  return a.frame.x - b.frame.x;
}

export function mergeAdjacentLines(lines: OcrLine[]): OcrLine[] {
  if (lines.length <= 1) return lines;

  const qrElements = lines.filter(isQrCodeElement);
  const textElements = lines.filter((l) => !isQrCodeElement(l));

  const sorted = [...textElements].sort(lineSort);
  const sortedQr = [...qrElements].sort(lineSort);

  const merged: OcrLine[] = [];

  for (const line of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(line);
      continue;
    }

    const sameRow = Math.abs(centerY(line.frame) - centerY(prev.frame)) <= 10;
    const prevRight = prev.frame.x + prev.frame.width;
    const gap = line.frame.x - prevRight;

    const qrBetween = sameRow
      ? sortedQr.some((qr) => {
          const qrTop = qr.frame.y;
          const qrBottom = qr.frame.y + qr.frame.height;
          const prevTop = prev.frame.y;
          const prevBottom = prev.frame.y + prev.frame.height;
          const verticalOverlap = Math.min(qrBottom, prevBottom) - Math.max(qrTop, prevTop);
          return qr.frame.x > prevRight &&
            qr.frame.x + qr.frame.width < line.frame.x &&
            verticalOverlap > 0;
        })
      : false;

    const maxGap = qrBetween ? 300 : 80;
    const horizontallyAdjacent = gap <= maxGap;

    if (sameRow && horizontallyAdjacent) {
      const x1 = Math.min(prev.frame.x, line.frame.x);
      const y1 = Math.min(prev.frame.y, line.frame.y);
      const x2 = Math.max(prevRight, line.frame.x + line.frame.width);
      const y2 = Math.max(prev.frame.y + prev.frame.height, line.frame.y + line.frame.height);

      merged[merged.length - 1] = {
        text: prev.text + ' ' + line.text,
        frame: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
      };
    } else {
      merged.push(line);
    }
  }

  const allMerged = [...merged, ...qrElements];
  allMerged.sort(lineSort);

  return allMerged;
}

export function mapRemoteToOcrResult(remote: RemoteOcrResult): OcrResult {
  const allLines: OcrLine[] = [];

  for (const page of remote.pages) {
    for (const element of page.elements) {
      const [x1, y1, x2, y2] = element.bbox;
      allLines.push({
        text: element.text,
        frame: {
          x: x1,
          y: y1,
          width: Math.max(1, x2 - x1),
          height: Math.max(1, y2 - y1),
        },
      });
    }
  }

  const mergedLines = mergeAdjacentLines(allLines);
  const sortedLines = sortLinesReadingOrder(mergedLines);

  const blocks: OcrBlock[] = sortedLines.map((line) => ({
    text: line.text,
    frame: line.frame,
    lines: [line],
  }));

  const text = blocks.map((block) => block.text).join('\n');

  return { text, blocks, modelData: remote };
}

export function mapRemoteCaseFields(remote: RemoteCaseFields | null): Partial<CaseFields> | null {
  if (!remote) return null;

  const result: Partial<CaseFields> = {};

  if (remote.patientName !== undefined) result.patientName = remote.patientName;
  if (remote.patientSex !== undefined) result.patientSex = remote.patientSex;
  if (remote.quantity !== undefined) result.quantity = remote.quantity;
  if (remote.directions !== undefined) result.directions = remote.directions;
  if (remote.pharmacyName !== undefined) result.pharmacyName = remote.pharmacyName;
  if (remote.pharmacyAddress !== undefined) result.pharmacyAddress = remote.pharmacyAddress;
  if (remote.pharmacistName !== undefined) result.pharmacistName = remote.pharmacistName;
  if (remote.physicianName !== undefined) result.physicianName = remote.physicianName;
  if (remote.dispensingDate !== undefined) result.dispensingDate = remote.dispensingDate;
  if (remote.prescriptionNo !== undefined) result.prescriptionNo = remote.prescriptionNo;
  if (remote.useBefore !== undefined) result.useBefore = remote.useBefore;

  if (remote.indications !== null && remote.indications !== undefined) {
    result.indications = [remote.indications];
  }
  if (remote.warnings !== null && remote.warnings !== undefined) {
    result.warnings = [remote.warnings];
  }
  if (remote.sideEffects !== null && remote.sideEffects !== undefined) {
    result.sideEffects = [remote.sideEffects];
  }

  return result;
}

export async function runRemoteOcrImage(uri: string): Promise<OcrResult> {
  let fileUri = uri;
  let tmpPath: string | null = null;

  if (__DEV__) {
    console.log('[OCR] upload url', `${OCR_SERVER_URL}/parse?lang=ch`);
    console.log('[OCR] input uri', uri);
    console.log('[OCR] has api key', Boolean(OCR_SERVER_API_KEY));
  }

  try {
    if (uri.startsWith('content://')) {
      tmpPath = FileSystem.cacheDirectory + 'ocr_upload_' + Date.now() + '.jpg';
      await FileSystem.copyAsync({ from: uri, to: tmpPath });
      fileUri = tmpPath;
      if (__DEV__) {
        console.log('[OCR] copied content:// ->', tmpPath);
      }
    }

    const uploadUrl = `${OCR_SERVER_URL}/parse?lang=ch`;

    const result = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      headers: { 'X-API-Key': OCR_SERVER_API_KEY },
    });

    if (__DEV__) {
      console.log('[OCR] upload status', result.status);
      console.log('[OCR] upload body head', (result.body ?? '').slice(0, 300));
    }

    if (result.status === 401) {
      throw new OcrUnavailableError('OCR server unavailable');
    }

    if (result.status < 200 || result.status >= 300) {
      throw new OcrUnavailableError('OCR server unavailable');
    }

    const remoteResult = JSON.parse(result.body) as RemoteOcrResult;

    if (!remoteResult.pages || remoteResult.pages.length === 0) {
      return { text: '', blocks: [], modelData: remoteResult };
    }

    return mapRemoteToOcrResult(remoteResult);
  } catch (error) {
    if (__DEV__) console.log('[OCR] upload error', error);
    if (error instanceof OcrUnavailableError) {
      throw error;
    }
    throw new OcrUnavailableError('OCR server unavailable');
  } finally {
    if (tmpPath) {
      FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
    }
  }
}

function requireOcrServerConfig(): void {
  if (!OCR_SERVER_URL) {
    throw new OcrUnavailableError('OCR server not configured');
  }
  if (!OCR_SERVER_API_KEY) {
    throw new OcrUnavailableError('OCR server API key not configured');
  }
}

export async function runOcrOnImages(uris: string[]): Promise<string> {
  if (!uris.length) return '';

  if (Platform.OS === 'web') return __DEV__ ? DEMO_WEB_OCR_TEXT : '';

  requireOcrServerConfig();

  const results = await Promise.all(uris.map(runRemoteOcrImage));
  return results
    .map((result) => result.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export async function runOcrOnImagesStructured(uris: string[]): Promise<OcrResult> {
  if (!uris.length) return { text: '', blocks: [] };

  if (Platform.OS === 'web') return __DEV__ ? DEMO_WEB_STRUCTURED_OCR : { text: '', blocks: [] };

  requireOcrServerConfig();

  const results = await Promise.all(uris.map(runRemoteOcrImage));

  const text = results.map((r) => r.text).filter(Boolean).join('\n\n');
  const blocks = results.flatMap((r) => r.blocks);

  const modelDatas = results
    .map((r) => r.modelData)
    .filter((m): m is RemoteOcrResult => m !== undefined);

  let modelData: RemoteOcrResult | undefined;
  if (modelDatas.length > 0) {
    modelData = {
      ...modelDatas[0],
      pages: modelDatas.flatMap((m) => m.pages),
      case_fields: modelDatas.find((m) => m.case_fields !== null)?.case_fields ?? null,
    };
  }

  return { text, blocks, ...(modelData ? { modelData } : {}) };
}
