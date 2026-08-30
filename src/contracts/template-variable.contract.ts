import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

export const TEMPLATE_VARIABLE_CONTRACT_VERSION = '1.0.0';

export interface TemplateVariableContract extends ContractEnvelope<
  typeof ContractSchemaName.TEMPLATE_VARIABLE
> {
  key: string;
  label: string;
  type: string;
  defaultValue: string | null;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
}

export function createTemplateVariableContract(
  payload: Omit<TemplateVariableContract, keyof ContractEnvelope>,
  version: string = TEMPLATE_VARIABLE_CONTRACT_VERSION,
): TemplateVariableContract {
  return {
    ...createContractEnvelope(ContractSchemaName.TEMPLATE_VARIABLE, version),
    ...payload,
  };
}

export class TemplateVariableSerializer extends JsonContractSerializer<TemplateVariableContract> {}

export class TemplateVariableValidator extends BaseContractValidator<TemplateVariableContract> {
  constructor() {
    super('TemplateVariable', ContractSchemaName.TEMPLATE_VARIABLE);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.key !== 'string' || record.key === '')
      issues.push('key must be a non-empty string');
    if (typeof record.label !== 'string' || record.label === '')
      issues.push('label must be a non-empty string');
    if (typeof record.type !== 'string' || record.type === '')
      issues.push('type must be a non-empty string');
    if (typeof record.sortOrder !== 'number') issues.push('sortOrder must be a number');
    return issues;
  }
}
