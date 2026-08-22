import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';
import type { TemplateVariableContract } from './template-variable.contract.js';

export const MANIFEST_CONTRACT_VERSION = '1.0.0';

/**
 * Scanner's one and only output shape. Nothing downstream (Laravel,
 * Render Node) ever reads a bespoke Scanner JSON — it's always this.
 */
export interface ManifestContract extends ContractEnvelope<typeof ContractSchemaName.MANIFEST> {
  /** Version of the internal manifest structure itself (independent of the envelope's Contract version). */
  schemaVersion: string;
  scannerVersion: string;
  engine: string;
  variables: TemplateVariableContract[];
  metadata: Record<string, unknown>;
}

export function createManifestContract(
  payload: Omit<ManifestContract, keyof ContractEnvelope>,
  version: string = MANIFEST_CONTRACT_VERSION,
): ManifestContract {
  return {
    ...createContractEnvelope(ContractSchemaName.MANIFEST, version),
    ...payload,
  };
}

export class ManifestSerializer extends JsonContractSerializer<ManifestContract> {}

export class ManifestValidator extends BaseContractValidator<ManifestContract> {
  constructor() {
    super('Manifest', ContractSchemaName.MANIFEST);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.schemaVersion !== 'string') issues.push('schemaVersion string olmalı');
    if (typeof record.scannerVersion !== 'string') issues.push('scannerVersion string olmalı');
    if (typeof record.engine !== 'string' || record.engine === '')
      issues.push('engine boş olmayan string olmalı');
    if (!Array.isArray(record.variables)) issues.push('variables dizi olmalı');
    if (typeof record.metadata !== 'object' || record.metadata === null)
      issues.push('metadata bir nesne olmalı');
    return issues;
  }
}
