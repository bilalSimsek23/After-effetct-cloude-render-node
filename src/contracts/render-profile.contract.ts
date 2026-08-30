import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const RENDER_PROFILE_CONTRACT_VERSION = '1.0.0';

export const RenderProfileCode = {
  PREVIEW: 'preview',
  MASTER: 'master',
  VERTICAL: 'vertical',
  SQUARE: 'square',
  PRORES: 'prores',
  ALPHA: 'alpha',
} as const;

export type RenderProfileCode = (typeof RenderProfileCode)[keyof typeof RenderProfileCode];

/** Preview, Master, Vertical, Square, ProRes, Alpha — all represented by this one shape. */
export interface RenderProfileContract extends ContractEnvelope<
  typeof ContractSchemaName.RENDER_PROFILE
> {
  code: RenderProfileCode;
  name: string;
  mediaEncoderPreset: string | null;
  watermarkEnabled: boolean;
  isActive: boolean;
}

export function createRenderProfileContract(
  payload: Omit<RenderProfileContract, keyof ContractEnvelope>,
  version: string = RENDER_PROFILE_CONTRACT_VERSION,
): RenderProfileContract {
  return {
    ...createContractEnvelope(ContractSchemaName.RENDER_PROFILE, version),
    ...payload,
  };
}

export class RenderProfileSerializer extends JsonContractSerializer<RenderProfileContract> {}

export class RenderProfileValidator extends BaseContractValidator<RenderProfileContract> {
  constructor() {
    super('RenderProfile', ContractSchemaName.RENDER_PROFILE);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (!Object.values(RenderProfileCode).includes(record.code as RenderProfileCode)) {
      issues.push(`code must be a valid RenderProfileCode; "${String(record.code)}" is invalid`);
    }
    if (typeof record.name !== 'string' || record.name === '')
      issues.push('name must be a non-empty string');
    if (typeof record.watermarkEnabled !== 'boolean')
      issues.push('watermarkEnabled must be a boolean');
    if (typeof record.isActive !== 'boolean') issues.push('isActive must be a boolean');
    return issues;
  }
}
