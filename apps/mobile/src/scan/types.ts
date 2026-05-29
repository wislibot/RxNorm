import type { CasePageParams } from '../case/navigationTypes';

export type CapturedPhoto = {
  id: string;
  uri: string;
};

export type ScanStackParamList = {
  HomeScanLanding: undefined;
  MedicineBagCapture: undefined;
  BrandPackageCapture: undefined;
  CaseDraft: {
    photos: CapturedPhoto[];
  };
  CasePage: CasePageParams;
  BrandDraft: {
    photo: CapturedPhoto;
  };
};
