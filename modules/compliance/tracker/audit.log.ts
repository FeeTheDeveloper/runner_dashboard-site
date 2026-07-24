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

let auditLog: AuditEntry[] = [];

export const logAudit = async (businessId: string, results: ComplianceResults) => {
  const entry: AuditEntry = {
    businessId,
    event: 'compliance_sync',
    results,
    createdAt: new Date(),
  };

  auditLog = appendAuditLog(auditLog, entry);

  return entry;
};

export const getAuditLog = () => [...auditLog];
