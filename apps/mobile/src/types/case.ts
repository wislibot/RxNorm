import type { SectionedOcr } from '../ocr/sectionMapper';
import type { RemoteOcrResult } from '../ocr/types';
import type { CaseFields } from './caseFields';

export type DetectedItem = {
  source?: 'ocr_line';
  rawText?: string;
  displayName: string;
  matchStatus: 'matched' | 'unmatched';
  confidence: number | null;
  ingredientId?: string;
  ingredientIds?: string[];
  matchMethod?: 'canonical_exact' | 'alias_exact' | 'paren_alias_exact' | null;
  nhiCode?: string;
  note?: string | null;
};

export type AutoShareStatus = {
  sharedCareTeamCount: number;
  isAutoShareDefault: boolean;
};

export type CaseType = 'medicine_bag' | 'brand_package';

export type CreateCaseInput = {
  caseType: CaseType;
  photoUris: string[];
  ocrRawText: string;
  ingredientIds: string[];
  sectionedOcr?: SectionedOcr;
};

export type OcrSections = {
  medicationLines: string[];
  instructionLines: string[];
  indicationsLines: string[];
  warningsLines: string[];
  sideEffectsLines: string[];
  dispensingDateLines: string[];
  quantityLines: string[];
  pharmacistLines: string[];
  caseFields?: CaseFields | null;
  remoteModel?: RemoteOcrResult | null;
};

export type CaseRecord = {
  caseId: string;
  caseType: CaseType;
  createdAt: string;
  updatedAt: string;
  ocrRawText: string;
  ocrSections: OcrSections;
  detectedItems: DetectedItem[];
  photoPaths: string[];
  photoUrls: string[];
  thumbUrls: string[];
  ingredientIds: string[];
  shareToAllCareTeams: boolean;
};

export type CaseSummary = {
  caseId: string;
  caseType: CaseType;
  createdAt: string;
  firstPhotoUrl: string | null;
  firstThumbUrl: string | null;
  ocrPreview: string;
  detectedItemCount: number;
};
