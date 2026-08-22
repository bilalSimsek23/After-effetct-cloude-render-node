import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const JOB_HEARTBEAT_CONTRACT_VERSION = '1.0.0';

export interface JobHeartbeatMemoryEntry {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
}

/** Only dynamic, per-tick metrics — identity/capability facts belong to Render Node / Capability Report Contract, not here. */
export interface JobHeartbeatContract extends ContractEnvelope<
  typeof ContractSchemaName.JOB_HEARTBEAT
> {
  nodeUuid: string;
  uptimeSeconds: number;
  memory: JobHeartbeatMemoryEntry;
  runningJobs: number;
  maxConcurrentJobs: number;
  applicationVersion: string;
  agentVersion: string;
}

export function createJobHeartbeatContract(
  payload: Omit<JobHeartbeatContract, keyof ContractEnvelope>,
  version: string = JOB_HEARTBEAT_CONTRACT_VERSION,
): JobHeartbeatContract {
  return {
    ...createContractEnvelope(ContractSchemaName.JOB_HEARTBEAT, version),
    ...payload,
  };
}

export class JobHeartbeatSerializer extends JsonContractSerializer<JobHeartbeatContract> {}

export class JobHeartbeatValidator extends BaseContractValidator<JobHeartbeatContract> {
  constructor() {
    super('JobHeartbeat', ContractSchemaName.JOB_HEARTBEAT);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.nodeUuid !== 'string' || record.nodeUuid === '')
      issues.push('nodeUuid boş olmayan string olmalı');
    if (typeof record.uptimeSeconds !== 'number' || record.uptimeSeconds < 0) {
      issues.push('uptimeSeconds negatif olmayan sayı olmalı');
    }
    if (typeof record.memory !== 'object' || record.memory === null)
      issues.push('memory bir nesne olmalı');
    if (typeof record.runningJobs !== 'number') issues.push('runningJobs sayısal olmalı');
    if (typeof record.maxConcurrentJobs !== 'number')
      issues.push('maxConcurrentJobs sayısal olmalı');
    return issues;
  }
}
