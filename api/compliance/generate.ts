export const generateComplianceDocument = async (type: string, payload: Record<string, unknown>) => ({
  type,
  payload,
  status: 'queued' as const,
});
