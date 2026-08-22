import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { parseContractVersion } from './contract-version.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

/**
 * v1.1.0 (Phase 4) added dependency/extracted/manifest/variables — purely
 * additive, so v1.0.0 payloads (Phase 2/3, before Project Preparation
 * existed) remain valid without those fields. v1.2.0 added `assets`
 * (buyer-uploaded IMAGE/VIDEO/AUDIO variable replacement downloads),
 * same additive treatment.
 */
export const WORKSPACE_CONTRACT_VERSION = '1.2.0';
export const WORKSPACE_CONTRACT_SUPPORTED_VERSIONS = ['1.0.0', '1.1.0', '1.2.0'];

/** Job Workspace paths, produced from exactly one model — never assembled ad hoc by a caller. */
export interface WorkspaceContract extends ContractEnvelope<typeof ContractSchemaName.WORKSPACE> {
  jobUuid: string;
  workspace: string;
  source: string;
  preview: string;
  master: string;
  cache: string;
  logs: string;
  /** Added in v1.1.0. */
  dependency?: string;
  /** Added in v1.1.0. */
  extracted?: string;
  /** Added in v1.1.0. */
  manifest?: string;
  /** Added in v1.1.0. */
  variables?: string;
  /** Added in v1.2.0. */
  assets?: string;
}

export function createWorkspaceContract(
  payload: Omit<WorkspaceContract, keyof ContractEnvelope>,
  version: string = WORKSPACE_CONTRACT_VERSION,
): WorkspaceContract {
  return {
    ...createContractEnvelope(ContractSchemaName.WORKSPACE, version),
    ...payload,
  };
}

export class WorkspaceSerializer extends JsonContractSerializer<WorkspaceContract> {}

export class WorkspaceValidator extends BaseContractValidator<WorkspaceContract> {
  constructor() {
    super('Workspace', ContractSchemaName.WORKSPACE);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    const baseFields = ['jobUuid', 'workspace', 'source', 'preview', 'master', 'cache', 'logs'];

    for (const field of baseFields) {
      if (typeof record[field] !== 'string' || record[field] === '') {
        issues.push(`${field} boş olmayan string olmalı`);
      }
    }

    const version = typeof record.version === 'string' ? record.version : '1.0.0';
    const parsed = parseContractVersion(version);
    const isV1_1OrLater = parsed.major > 1 || (parsed.major === 1 && parsed.minor >= 1);
    const isV1_2OrLater = parsed.major > 1 || (parsed.major === 1 && parsed.minor >= 2);

    if (isV1_1OrLater) {
      for (const field of ['dependency', 'extracted', 'manifest', 'variables']) {
        if (typeof record[field] !== 'string' || record[field] === '') {
          issues.push(`${field} boş olmayan string olmalı (v1.1.0+ zorunlu alan)`);
        }
      }
    }

    if (isV1_2OrLater && (typeof record.assets !== 'string' || record.assets === '')) {
      issues.push('assets boş olmayan string olmalı (v1.2.0+ zorunlu alan)');
    }

    return issues;
  }
}
