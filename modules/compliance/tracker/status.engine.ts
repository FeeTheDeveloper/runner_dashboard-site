import type { ComplianceResults } from '../types';

export type ComplianceStatus = 'pending' | 'in_progress' | 'submitted' | 'complete' | 'failed';

const allowedStatuses: ComplianceStatus[] = ['pending', 'in_progress', 'submitted', 'complete', 'failed'];

export const resolveComplianceStatus = (
  status: string,
  fallback: ComplianceStatus | null = null
): ComplianceStatus => {
  if (allowedStatuses.includes(status as ComplianceStatus)) {
    return status as ComplianceStatus;
  }

  if (fallback !== null) {
    return fallback;
  }

  throw new Error(`Invalid compliance status: ${status}`);
};

export const normalizeStatus = (results: ComplianceResults) => ({
  irs: results.irs?.status || 'pending',
  comptroller: results.comptroller?.status || 'pending',
  experian: results.experian?.status || 'pending',
  equifax: results.equifax?.status || 'pending',
  dnb: results.dnb?.status || 'pending',
});
