import type { ContractEnvelope, ContractSchemaName } from '../contract-envelope.js';
import type { ContractSerializer } from './contract-serializer.js';
import type { ContractValidator } from './contract-validator.js';
import type { ContractName } from './contract-name.js';

export const ContractStatus = {
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
} as const;

export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

export interface ContractRegistryEntry<T extends ContractEnvelope = ContractEnvelope> {
  name: ContractName;
  schemaName: ContractSchemaName;
  currentVersion: string;
  supportedVersions: string[];
  status: ContractStatus;
  serializer: ContractSerializer<T>;
  validator: ContractValidator<T>;
}
