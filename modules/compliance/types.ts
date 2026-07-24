export interface BusinessProfile {
  id: string;
  legalName: string;
  ein: string;
  oldAddress: string;
  newAddress: string;
}

export interface ComplianceStepResult {
  status: string;
  [key: string]: unknown;
}

export interface ComplianceResults {
  irs?: ComplianceStepResult;
  comptroller?: ComplianceStepResult;
  experian?: ComplianceStepResult;
  equifax?: ComplianceStepResult;
  dnb?: ComplianceStepResult;
  [key: string]: unknown;
}
