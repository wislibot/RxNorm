export type OcrRect = { x: number; y: number; width: number; height: number };

export type OcrLine = { text: string; frame: OcrRect; photoIndex?: number };

export type OcrBlock = { text: string; frame: OcrRect; lines: OcrLine[]; photoIndex?: number };

export type RemoteOcrElement = {
  type: string;
  text: string;
  bbox: number[];
  confidence: number;
  photo_index?: number;
};

export type RemoteOcrPage = {
  width: number;
  height: number;
  elements: RemoteOcrElement[];
};

export type RemoteCaseFields = {
  patientName: string | null;
  patientSex: 'M' | 'F' | null;
  prescriptionNo: string | null;
  medicationName: string | null;
  quantity: string | null;
  directions: string | null;
  indications: string | null;
  warnings: string | null;
  sideEffects: string | null;
  appearance: string | null;
  pharmacyName: string | null;
  pharmacyAddress: string | null;
  pharmacistName: string | null;
  physicianName: string | null;
  dispensingDate: string | null;
  useBefore: string | null;
};

export type RemoteOcrResult = {
  engine: string;
  version: string;
  pages: RemoteOcrPage[];
  case_fields: RemoteCaseFields | null;
  extraction_engine: string;
  extraction_fallback: boolean;
  photo_count?: number;
};

export type PhotoAttribution = {
  photoIndex: number;
  sectionKeys: string[];
  lineCount: number;
};

export type OcrResult = { text: string; blocks: OcrBlock[]; modelData?: RemoteOcrResult };
