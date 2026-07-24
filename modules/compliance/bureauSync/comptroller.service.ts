import type { BusinessProfile } from '../types';

export const submitComptroller = async (data: BusinessProfile) => ({
  bureau: 'Comptroller',
  status: 'submitted' as const,
  method: 'manual/web' as const,
  businessId: data.id,
  timestamp: new Date(),
});

export const comptrollerService = {
  sync: submitComptroller,
};
