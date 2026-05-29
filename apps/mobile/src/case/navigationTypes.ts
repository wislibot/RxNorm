export type CasePageParams = {
  caseId: string;
};

export type MyMedsStackParamList = {
  MyMedsHome: undefined;
  CaseHistory: undefined;
  CasePage: CasePageParams;
};
