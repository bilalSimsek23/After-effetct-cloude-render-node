import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';
import { SystemStatusCode } from './system-status.contract.js';

export const ADOBE_ENVIRONMENT_CONTRACT_VERSION = '1.0.0';

export interface AdobeAppStatusEntry {
  name: string;
  installed: boolean;
  version: string | null;
}

/** Reuses SystemStatusCode: an environment check is one specific instance of "is this fit to accept work". */
export interface AdobeEnvironmentContract extends ContractEnvelope<
  typeof ContractSchemaName.ADOBE_ENVIRONMENT
> {
  status: SystemStatusCode;
  errors: string[];
  afterEffects: AdobeAppStatusEntry;
  mediaEncoder: AdobeAppStatusEntry;
  sameMajorVersionFamily: boolean;
  dynamicLinkAvailable: boolean;
  workspaceReady: boolean;
}

export function createAdobeEnvironmentContract(
  payload: Omit<AdobeEnvironmentContract, keyof ContractEnvelope>,
  version: string = ADOBE_ENVIRONMENT_CONTRACT_VERSION,
): AdobeEnvironmentContract {
  return {
    ...createContractEnvelope(ContractSchemaName.ADOBE_ENVIRONMENT, version),
    ...payload,
  };
}

export class AdobeEnvironmentSerializer extends JsonContractSerializer<AdobeEnvironmentContract> {}

export class AdobeEnvironmentValidator extends BaseContractValidator<AdobeEnvironmentContract> {
  constructor() {
    super('AdobeEnvironment', ContractSchemaName.ADOBE_ENVIRONMENT);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (!Object.values(SystemStatusCode).includes(record.status as SystemStatusCode)) {
      issues.push(
        `status must be a valid SystemStatusCode; "${String(record.status)}" is invalid`,
      );
    }
    if (!Array.isArray(record.errors)) issues.push('errors must be an array');
    for (const field of ['afterEffects', 'mediaEncoder']) {
      if (typeof record[field] !== 'object' || record[field] === null) {
        issues.push(`${field} must be an object`);
      }
    }
    for (const field of ['sameMajorVersionFamily', 'dynamicLinkAvailable', 'workspaceReady']) {
      if (typeof record[field] !== 'boolean') issues.push(`${field} must be a boolean`);
    }
    return issues;
  }
}
