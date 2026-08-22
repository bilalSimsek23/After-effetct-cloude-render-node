import type { ContractEnvelope, ContractSchemaName } from '../contract-envelope.js';
import type { ContractName } from './contract-name.js';
import type { ContractRegistryEntry } from './contract-registry.types.js';

export class ContractNotFoundError extends Error {
  constructor(name: string) {
    super(`Registry'de kayıtlı bir Contract bulunamadı: "${name}"`);
    this.name = 'ContractNotFoundError';
  }
}

/**
 * The single source of truth for every Contract in the platform: its
 * current version, which older versions are still supported, its
 * lifecycle status, and how to serialize/validate it. No service reads a
 * Contract file directly or hardcodes a schema name/version — everything
 * goes through an instance of this class.
 *
 * Not a singleton: main.ts (or whichever entry point needs it) builds one
 * via createDefaultContractRegistry() and passes it around through
 * constructors, same as every other service in this codebase.
 */
export class ContractRegistry {
  private readonly entries = new Map<ContractName, ContractRegistryEntry>();

  register<T extends ContractEnvelope>(entry: ContractRegistryEntry<T>): void {
    this.entries.set(entry.name, entry as ContractRegistryEntry);
  }

  getContract(name: ContractName): ContractRegistryEntry {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new ContractNotFoundError(name);
    }
    return entry;
  }

  getCurrentVersion(name: ContractName): string {
    return this.getContract(name).currentVersion;
  }

  isSupported(name: ContractName, version: string): boolean {
    return this.getContract(name).supportedVersions.includes(version);
  }

  getSchema(name: ContractName): ContractSchemaName {
    return this.getContract(name).schemaName;
  }

  validate(name: ContractName, value: unknown): ContractEnvelope {
    return this.getContract(name).validator.validate(value);
  }

  listContracts(): ContractRegistryEntry[] {
    return Array.from(this.entries.values());
  }
}
