import type { ContractEnvelope, ContractSchemaName } from '../contract-envelope.js';

export class ContractValidationError extends Error {
  constructor(
    contractName: string,
    public readonly issues: string[],
  ) {
    super(`"${contractName}" contract doğrulaması başarısız: ${issues.join(', ')}`);
    this.name = 'ContractValidationError';
  }
}

export interface ContractValidator<T extends ContractEnvelope> {
  validate(value: unknown): T;
}

/**
 * Shared envelope validation (schema/version/createdAt) for every
 * Contract. Concrete validators (ManifestValidator, RenderJobValidator,
 * ...) only implement validatePayload() for their own fields — adding a
 * new Contract never requires touching this base class (Open/Closed).
 */
export abstract class BaseContractValidator<
  T extends ContractEnvelope,
> implements ContractValidator<T> {
  constructor(
    private readonly contractName: string,
    private readonly expectedSchema: ContractSchemaName,
  ) {}

  validate(value: unknown): T {
    const issues = this.validateEnvelope(value);

    if (typeof value === 'object' && value !== null) {
      issues.push(...this.validatePayload(value as Record<string, unknown>));
    }

    if (issues.length > 0) {
      throw new ContractValidationError(this.contractName, issues);
    }

    return value as T;
  }

  protected abstract validatePayload(record: Record<string, unknown>): string[];

  private validateEnvelope(value: unknown): string[] {
    if (typeof value !== 'object' || value === null) {
      return ['payload bir JSON nesnesi olmalı'];
    }

    const record = value as Record<string, unknown>;
    const issues: string[] = [];

    if (record.schema !== this.expectedSchema) {
      issues.push(`schema "${this.expectedSchema}" olmalı, "${String(record.schema)}" geldi`);
    }
    if (typeof record.version !== 'string' || record.version === '') {
      issues.push('version boş olmayan bir string olmalı');
    }
    if (typeof record.createdAt !== 'string' || record.createdAt === '') {
      issues.push('createdAt boş olmayan bir string olmalı');
    }

    return issues;
  }
}
