export type BrandMatch = {
  productId?: string;
  nhiCode?: string;
  displayName: string;
  nameZh?: string | null;
  nameEn?: string | null;
  confidence?: number;
};

export type CaseFields = {
  patientName?: string | null;
  patientSex?: 'M' | 'F' | null;

  quantity?: string | null;
  directions?: string | null;
  indications?: string[];
  warnings?: string[];
  sideEffects?: string[];

  pharmacyName?: string | null;
  pharmacyAddress?: string | null;
  pharmacistName?: string | null;
  physicianName?: string | null;

  dispensingDate?: string | null;

  prescriptionNo?: string | null;
  useBefore?: string | null;

  brandNames?: string[];
  brandMatches?: BrandMatch[];
};
