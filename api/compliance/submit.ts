export const submitComplianceRecord = async (record: Record<string, unknown>) => ({
  ...record,
  submitted: true,
});
