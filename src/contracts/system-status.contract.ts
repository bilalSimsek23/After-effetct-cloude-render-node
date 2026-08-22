import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const SYSTEM_STATUS_CONTRACT_VERSION = '1.0.0';

export const SystemStatusCode = {
  READY: 'READY',
  NOT_READY: 'NOT_READY',
  BUSY: 'BUSY',
  OFFLINE: 'OFFLINE',
  ERROR: 'ERROR',
} as const;

export type SystemStatusCode = (typeof SystemStatusCode)[keyof typeof SystemStatusCode];

/** The only model Render Node ever reports its overall status to Laravel through. */
export interface SystemStatusContract extends ContractEnvelope<
  typeof ContractSchemaName.SYSTEM_STATUS
> {
  status: SystemStatusCode;
  errors: string[];
  details: Record<string, unknown> | null;
}

export function createSystemStatusContract(
  payload: Omit<SystemStatusContract, keyof ContractEnvelope>,
  version: string = SYSTEM_STATUS_CONTRACT_VERSION,
): SystemStatusContract {
  return {
    ...createContractEnvelope(ContractSchemaName.SYSTEM_STATUS, version),
    ...payload,
  };
}

export class SystemStatusSerializer extends JsonContractSerializer<SystemStatusContract> {}

export class SystemStatusValidator extends BaseContractValidator<SystemStatusContract> {
  constructor() {
    super('SystemStatus', ContractSchemaName.SYSTEM_STATUS);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (!Object.values(SystemStatusCode).includes(record.status as SystemStatusCode)) {
      issues.push(
        `status geçerli bir SystemStatusCode olmalı, "${String(record.status)}" geçersiz`,
      );
    }
    if (!Array.isArray(record.errors)) issues.push('errors dizi olmalı');
    return issues;
  }
}
