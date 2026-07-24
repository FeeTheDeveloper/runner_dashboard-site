export type AuditEntry = {
  event: string;
  createdAt: Date;
};

export const appendAuditLog = (log: AuditEntry[], entry: AuditEntry, mutate = false) => {
  if (mutate) {
    log.push(entry);
    return log;
  }

  return [...log, entry];
};
