export type ComplianceStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

const statusMap: Record<string, ComplianceStatus> = {
  pending: 'pending',
  in_progress: 'in_progress',
  complete: 'complete',
  failed: 'failed',
};

export const resolveComplianceStatus = (status: string): ComplianceStatus =>
  statusMap[status] ?? 'failed';
