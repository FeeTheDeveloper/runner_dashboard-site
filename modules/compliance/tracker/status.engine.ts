export type ComplianceStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

export const resolveComplianceStatus = (status: ComplianceStatus) => status;
