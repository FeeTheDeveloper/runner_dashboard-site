import type { BusinessProfile } from '../types';

export const generateBureauLetter = async (business: BusinessProfile) => ({
  type: 'bureau-letter',
  addressees: ['Experian', 'Equifax', 'D&B'],
  content: `Please update ${business.legalName} (${business.ein}) from ${business.oldAddress} to ${business.newAddress}.`,
});
