export type CasePageParams = {
  caseId: string;
};

export type MyMedsStackParamList = {
  MyMedsHome: undefined;
  CaseHistory: undefined;
  CasePage: CasePageParams;
  SavedMeds: undefined;
  PlaylistsHome: undefined;
  PlaylistDetail: { playlistId: string; playlistName: string };
  DrugDetail: { nhiCode: string };
};
