import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const RENDER_NODE_CONTRACT_VERSION = '1.0.0';

/** Identity/version facts about one Render Node — not its live metrics (see Job Heartbeat Contract for those). */
export interface RenderNodeContract extends ContractEnvelope<
  typeof ContractSchemaName.RENDER_NODE
> {
  nodeUuid: string;
  nodeName: string;
  engine: string;
  supportedEngines: string[];
  agentVersion: string;
  applicationVersion: string;
}

export function createRenderNodeContract(
  payload: Omit<RenderNodeContract, keyof ContractEnvelope>,
  version: string = RENDER_NODE_CONTRACT_VERSION,
): RenderNodeContract {
  return {
    ...createContractEnvelope(ContractSchemaName.RENDER_NODE, version),
    ...payload,
  };
}

export class RenderNodeSerializer extends JsonContractSerializer<RenderNodeContract> {}

export class RenderNodeValidator extends BaseContractValidator<RenderNodeContract> {
  constructor() {
    super('RenderNode', ContractSchemaName.RENDER_NODE);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    for (const field of ['nodeUuid', 'nodeName', 'engine', 'agentVersion', 'applicationVersion']) {
      if (typeof record[field] !== 'string' || record[field] === '') {
        issues.push(`${field} must be a non-empty string`);
      }
    }
    if (!Array.isArray(record.supportedEngines)) issues.push('supportedEngines must be an array');
    return issues;
  }
}
