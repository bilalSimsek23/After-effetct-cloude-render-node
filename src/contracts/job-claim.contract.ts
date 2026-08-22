import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';
import type { JobLeaseContract } from './job-lease.contract.js';

export const JOB_CLAIM_CONTRACT_VERSION = '1.0.0';

/** What a Render Node receives when it successfully claims a job — pairs the job with its lease. */
export interface JobClaimContract extends ContractEnvelope<typeof ContractSchemaName.JOB_CLAIM> {
  jobUuid: string;
  nodeUuid: string;
  claimedAt: string;
  lease: JobLeaseContract;
}

export function createJobClaimContract(
  payload: Omit<JobClaimContract, keyof ContractEnvelope>,
  version: string = JOB_CLAIM_CONTRACT_VERSION,
): JobClaimContract {
  return {
    ...createContractEnvelope(ContractSchemaName.JOB_CLAIM, version),
    ...payload,
  };
}

export class JobClaimSerializer extends JsonContractSerializer<JobClaimContract> {}

export class JobClaimValidator extends BaseContractValidator<JobClaimContract> {
  constructor() {
    super('JobClaim', ContractSchemaName.JOB_CLAIM);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    for (const field of ['jobUuid', 'nodeUuid', 'claimedAt']) {
      if (typeof record[field] !== 'string' || record[field] === '') {
        issues.push(`${field} boş olmayan string olmalı`);
      }
    }
    if (typeof record.lease !== 'object' || record.lease === null)
      issues.push('lease bir nesne olmalı');
    return issues;
  }
}
