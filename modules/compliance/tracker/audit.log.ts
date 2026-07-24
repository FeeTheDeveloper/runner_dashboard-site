export type AuditEntry = {
  event: string;
  createdAt: string;
};

export const appendAuditLog = (log: AuditEntry[], entry: AuditEntry) => {
  log.push(entry);
  return log;
};
