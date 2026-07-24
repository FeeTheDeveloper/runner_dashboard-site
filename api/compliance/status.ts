export const getComplianceStatus = async (id: string) => ({
  id,
  status: 'pending' as const,
});
