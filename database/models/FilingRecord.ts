export type FilingRecord = {
  id: string;
  filingType: string;
  status: 'draft' | 'submitted' | 'accepted' | 'rejected';
  createdAt: string;
};
