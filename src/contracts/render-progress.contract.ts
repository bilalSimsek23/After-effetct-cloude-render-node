import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const RENDER_PROGRESS_CONTRACT_VERSION = '1.0.0';

export const RenderProgressStatus = {
  QUEUED: 'queued',
  PREPARING: 'preparing',
  RENDERING: 'rendering',
  ENCODING: 'encoding',
  UPLOADING: 'uploading',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type RenderProgressStatus = (typeof RenderProgressStatus)[keyof typeof RenderProgressStatus];

/** The only model sent while a render is in flight. */
export interface RenderProgressContract extends ContractEnvelope<
  typeof ContractSchemaName.RENDER_PROGRESS
> {
  status: RenderProgressStatus;
  percentage: number;
  currentStep: string;
  estimatedRemainingSeconds: number | null;
}

export function createRenderProgressContract(
  payload: Omit<RenderProgressContract, keyof ContractEnvelope>,
  version: string = RENDER_PROGRESS_CONTRACT_VERSION,
): RenderProgressContract {
  return {
    ...createContractEnvelope(ContractSchemaName.RENDER_PROGRESS, version),
    ...payload,
  };
}

export class RenderProgressSerializer extends JsonContractSerializer<RenderProgressContract> {}

export class RenderProgressValidator extends BaseContractValidator<RenderProgressContract> {
  constructor() {
    super('RenderProgress', ContractSchemaName.RENDER_PROGRESS);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (!Object.values(RenderProgressStatus).includes(record.status as RenderProgressStatus)) {
      issues.push(
        `status must be a valid RenderProgressStatus; "${String(record.status)}" is invalid`,
      );
    }
    if (typeof record.percentage !== 'number' || record.percentage < 0 || record.percentage > 100) {
      issues.push('percentage must be a number between 0 and 100');
    }
    if (typeof record.currentStep !== 'string' || record.currentStep === '') {
      issues.push('currentStep must be a non-empty string');
    }
    return issues;
  }
}
