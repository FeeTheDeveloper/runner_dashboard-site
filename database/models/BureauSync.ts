export type BureauSync = {
  id: string;
  bureau: string;
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
  updatedAt: string;
};
