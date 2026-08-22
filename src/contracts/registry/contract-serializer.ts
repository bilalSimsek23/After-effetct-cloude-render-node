import type { ContractEnvelope } from '../contract-envelope.js';

export interface ContractSerializer<T extends ContractEnvelope> {
  serialize(value: T): string;
  deserialize(json: string): T;
}

/**
 * Shared JSON serialization for every Contract. Named per-contract
 * subclasses (ManifestSerializer, RenderJobSerializer, ...) exist so each
 * Contract has its own identity in the registry, but the actual
 * serialization logic lives here exactly once.
 */
export class JsonContractSerializer<T extends ContractEnvelope> implements ContractSerializer<T> {
  serialize(value: T): string {
    return JSON.stringify(value);
  }

  deserialize(json: string): T {
    return JSON.parse(json) as T;
  }
}
