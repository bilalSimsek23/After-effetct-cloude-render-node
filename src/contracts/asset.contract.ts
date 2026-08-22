import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const ASSET_CONTRACT_VERSION = '1.0.0';

export const AssetType = {
  FONT: 'font',
  PRESET: 'preset',
  SCRIPT: 'script',
  PROJECT: 'project',
  PREVIEW: 'preview',
  MASTER: 'master',
  LICENSE: 'license',
  OTHER: 'other',
} as const;

export type AssetType = (typeof AssetType)[keyof typeof AssetType];

/** Every file the platform passes around — a dependency font, a render output, a project file — is this shape. */
export interface AssetContract extends ContractEnvelope<typeof ContractSchemaName.ASSET> {
  uuid: string;
  hash: string;
  size: number;
  type: AssetType;
  downloadUrl: string;
  cacheKey: string;
}

export function createAssetContract(
  payload: Omit<AssetContract, keyof ContractEnvelope>,
  version: string = ASSET_CONTRACT_VERSION,
): AssetContract {
  return {
    ...createContractEnvelope(ContractSchemaName.ASSET, version),
    ...payload,
  };
}

export class AssetSerializer extends JsonContractSerializer<AssetContract> {}

export class AssetValidator extends BaseContractValidator<AssetContract> {
  constructor() {
    super('Asset', ContractSchemaName.ASSET);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.uuid !== 'string' || record.uuid === '')
      issues.push('uuid boş olmayan string olmalı');
    if (typeof record.hash !== 'string' || record.hash === '')
      issues.push('hash boş olmayan string olmalı');
    if (typeof record.size !== 'number' || record.size < 0)
      issues.push('size negatif olmayan sayı olmalı');
    if (!Object.values(AssetType).includes(record.type as AssetType)) {
      issues.push(`type geçerli bir AssetType olmalı, "${String(record.type)}" geçersiz`);
    }
    if (typeof record.downloadUrl !== 'string' || record.downloadUrl === '') {
      issues.push('downloadUrl boş olmayan string olmalı');
    }
    if (typeof record.cacheKey !== 'string' || record.cacheKey === '') {
      issues.push('cacheKey boş olmayan string olmalı');
    }
    return issues;
  }
}
