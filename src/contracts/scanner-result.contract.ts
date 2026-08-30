import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';
import type { ManifestContract } from './manifest.contract.js';

export const SCANNER_RESULT_CONTRACT_VERSION = '1.0.0';

/** The outer envelope of one scan operation; `manifest` is the payload when it succeeds. */
export interface ScannerResultContract extends ContractEnvelope<
  typeof ContractSchemaName.SCANNER_RESULT
> {
  success: boolean;
  manifest: ManifestContract | null;
  errors: string[];
  durationMs: number;
}

export function createScannerResultContract(
  payload: Omit<ScannerResultContract, keyof ContractEnvelope>,
  version: string = SCANNER_RESULT_CONTRACT_VERSION,
): ScannerResultContract {
  return {
    ...createContractEnvelope(ContractSchemaName.SCANNER_RESULT, version),
    ...payload,
  };
}

export class ScannerResultSerializer extends JsonContractSerializer<ScannerResultContract> {}

export class ScannerResultValidator extends BaseContractValidator<ScannerResultContract> {
  constructor() {
    super('ScannerResult', ContractSchemaName.SCANNER_RESULT);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.success !== 'boolean') issues.push('success must be a boolean');
    if (!Array.isArray(record.errors)) issues.push('errors must be an array');
    if (typeof record.durationMs !== 'number') issues.push('durationMs must be a number');
    if (record.manifest !== null && typeof record.manifest !== 'object') {
      issues.push('manifest must be an object or null');
    }
    return issues;
  }
}
