import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const RENDER_JOB_CONTRACT_VERSION = '1.0.0';

export const RenderJobPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
} as const;

export type RenderJobPriority = (typeof RenderJobPriority)[keyof typeof RenderJobPriority];

export const RenderJobRenderType = {
  PREVIEW: 'preview',
  MASTER: 'master',
} as const;

export type RenderJobRenderType = (typeof RenderJobRenderType)[keyof typeof RenderJobRenderType];

/** The only model Render Queue reads a job through. */
export interface RenderJobContract extends ContractEnvelope<typeof ContractSchemaName.RENDER_JOB> {
  jobUuid: string;
  templateUuid: string;
  projectUuid: string;
  userUuid: string;
  variables: Record<string, unknown>;
  priority: RenderJobPriority;
  renderType: RenderJobRenderType;
}

export function createRenderJobContract(
  payload: Omit<RenderJobContract, keyof ContractEnvelope>,
  version: string = RENDER_JOB_CONTRACT_VERSION,
): RenderJobContract {
  return {
    ...createContractEnvelope(ContractSchemaName.RENDER_JOB, version),
    ...payload,
  };
}

export class RenderJobSerializer extends JsonContractSerializer<RenderJobContract> {}

export class RenderJobValidator extends BaseContractValidator<RenderJobContract> {
  constructor() {
    super('RenderJob', ContractSchemaName.RENDER_JOB);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    for (const field of ['jobUuid', 'templateUuid', 'projectUuid', 'userUuid']) {
      if (typeof record[field] !== 'string' || record[field] === '') {
        issues.push(`${field} must be a non-empty string`);
      }
    }
    if (typeof record.variables !== 'object' || record.variables === null) {
      issues.push('variables must be an object');
    }
    if (!Object.values(RenderJobPriority).includes(record.priority as RenderJobPriority)) {
      issues.push(
        `priority must be a valid RenderJobPriority; "${String(record.priority)}" is invalid`,
      );
    }
    if (!Object.values(RenderJobRenderType).includes(record.renderType as RenderJobRenderType)) {
      issues.push(
        `renderType must be a valid RenderJobRenderType; "${String(record.renderType)}" is invalid`,
      );
    }
    return issues;
  }
}
