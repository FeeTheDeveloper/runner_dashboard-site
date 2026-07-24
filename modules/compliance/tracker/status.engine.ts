export type ComplianceStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

const allowedStatuses: ComplianceStatus[] = ['pending', 'in_progress', 'complete', 'failed'];

export const resolveComplianceStatus = (
  status: string,
  fallback: ComplianceStatus | null = 'failed'
): ComplianceStatus => {
  if (allowedStatuses.includes(status as ComplianceStatus)) {
    return status as ComplianceStatus;
  }

  if (fallback !== null) {
    return fallback;
  }

  throw new Error(`Invalid compliance status: ${status}`);
};
