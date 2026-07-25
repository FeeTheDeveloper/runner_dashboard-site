import { submitComptroller } from './bureauSync/comptroller.service';
import { submitIRS } from './bureauSync/irs.service';
import { generate8822B } from './formGenerator/8822b.generator';
import { generateBureauLetter } from './formGenerator/bureauLetter.generator';
import { logAudit } from './tracker/audit.log';
import type { BusinessProfile, ComplianceResults, ComplianceStepResult } from './types';

export const runComplianceSync = async (business: BusinessProfile): Promise<ComplianceResults> => {
  const results: ComplianceResults = {};

  const irsDoc = await generate8822B(business);
  const bureauLetter = await generateBureauLetter(business);

  results.irs = await submitIRS(irsDoc);
  results.comptroller = await submitComptroller(business);

  const pendingBureauResult: ComplianceStepResult = {
    status: 'pending',
    letterReady: Boolean(bureauLetter),
  };

  results.experian = { ...pendingBureauResult, bureau: 'Experian' };
  results.equifax = { ...pendingBureauResult, bureau: 'Equifax' };
  results.dnb = { ...pendingBureauResult, bureau: 'D&B' };

  await logAudit(business.id, results);

  return results;
};
