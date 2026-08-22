import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';
import type { AssetContract } from './asset.contract.js';

export const RENDER_RESULT_CONTRACT_VERSION = '1.0.0';

/** The only model a completed render is ever reported as. Output files reuse Asset Contract — never a bespoke shape. */
export interface RenderResultContract extends ContractEnvelope<
  typeof ContractSchemaName.RENDER_RESULT
> {
  previewUrl: string | null;
  masterUrl: string | null;
  durationSeconds: number;
  files: AssetContract[];
  logs: string[];
  warnings: string[];
}

export function createRenderResultContract(
  payload: Omit<RenderResultContract, keyof ContractEnvelope>,
  version: string = RENDER_RESULT_CONTRACT_VERSION,
): RenderResultContract {
  return {
    ...createContractEnvelope(ContractSchemaName.RENDER_RESULT, version),
    ...payload,
  };
}

export class RenderResultSerializer extends JsonContractSerializer<RenderResultContract> {}

export class RenderResultValidator extends BaseContractValidator<RenderResultContract> {
  constructor() {
    super('RenderResult', ContractSchemaName.RENDER_RESULT);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.durationSeconds !== 'number' || record.durationSeconds < 0) {
      issues.push('durationSeconds negatif olmayan sayı olmalı');
    }
    if (!Array.isArray(record.files)) issues.push('files dizi olmalı');
    if (!Array.isArray(record.logs)) issues.push('logs dizi olmalı');
    if (!Array.isArray(record.warnings)) issues.push('warnings dizi olmalı');
    return issues;
  }
}
