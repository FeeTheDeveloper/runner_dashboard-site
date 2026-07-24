import type { ComplianceResults } from '../types';

export type AuditEntry = {
  businessId: string;
  event: string;
  results: ComplianceResults;
  createdAt: Date;
};

export const appendAuditLog = (log: AuditEntry[], entry: AuditEntry, mutate = false) => {
  if (mutate) {
    log.push(entry);
    return log;
  }

  return [...log, entry];
};

export const logAudit = async (businessId: string, results: ComplianceResults) => {
  return {
    businessId,
    event: 'compliance_sync',
    results,
    createdAt: new Date(),
  };
};
