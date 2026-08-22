import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const JOB_LEASE_CONTRACT_VERSION = '1.0.0';

/** Render Farm lease: how long a node holds exclusive claim to a job before it must renew or lose it. */
export interface JobLeaseContract extends ContractEnvelope<typeof ContractSchemaName.JOB_LEASE> {
  leaseId: string;
  leaseExpireAt: string;
  renewIntervalSeconds: number;
  retryCount: number;
}

export function createJobLeaseContract(
  payload: Omit<JobLeaseContract, keyof ContractEnvelope>,
  version: string = JOB_LEASE_CONTRACT_VERSION,
): JobLeaseContract {
  return {
    ...createContractEnvelope(ContractSchemaName.JOB_LEASE, version),
    ...payload,
  };
}

export class JobLeaseSerializer extends JsonContractSerializer<JobLeaseContract> {}

export class JobLeaseValidator extends BaseContractValidator<JobLeaseContract> {
  constructor() {
    super('JobLease', ContractSchemaName.JOB_LEASE);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.leaseId !== 'string' || record.leaseId === '')
      issues.push('leaseId boş olmayan string olmalı');
    if (typeof record.leaseExpireAt !== 'string' || record.leaseExpireAt === '') {
      issues.push('leaseExpireAt boş olmayan string olmalı');
    }
    if (typeof record.renewIntervalSeconds !== 'number' || record.renewIntervalSeconds <= 0) {
      issues.push('renewIntervalSeconds pozitif sayı olmalı');
    }
    if (typeof record.retryCount !== 'number' || record.retryCount < 0) {
      issues.push('retryCount negatif olmayan sayı olmalı');
    }
    return issues;
  }
}
