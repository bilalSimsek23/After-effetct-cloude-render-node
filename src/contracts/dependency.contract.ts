import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { parseContractVersion } from './contract-version.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';

/**
 * v1.1.0 (Phase 4) added luts/expressions/assets — purely additive, so
 * v1.0.0 dependency packages (fonts/plugins/presets/scripts/licenses
 * only) remain valid and don't need re-uploading.
 */
export const DEPENDENCY_CONTRACT_VERSION = '1.1.0';
export const DEPENDENCY_CONTRACT_SUPPORTED_VERSIONS = ['1.0.0', '1.1.0'];

export interface DependencyFontEntry {
  family: string;
  style?: string;
  autoInstall?: boolean;
}

export interface DependencyPluginEntry {
  name: string;
  required?: boolean;
  autoInstall?: boolean;
}

export interface DependencyPresetEntry {
  name: string;
}

export interface DependencyScriptEntry {
  name: string;
}

export interface DependencyLicenseEntry {
  name: string;
}

/** Added in v1.1.0. */
export interface DependencyLutEntry {
  name: string;
}

/** Added in v1.1.0. */
export interface DependencyExpressionEntry {
  name: string;
}

/** Added in v1.1.0 — generic files a dependency package carries (images, footage, ...) beyond the other typed sections. */
export interface DependencyAssetEntry {
  name: string;
}

/** The only shape Dependency Package is ever read through. */
export interface DependencyContract extends ContractEnvelope<typeof ContractSchemaName.DEPENDENCY> {
  fonts: DependencyFontEntry[];
  plugins: DependencyPluginEntry[];
  presets: DependencyPresetEntry[];
  scripts: DependencyScriptEntry[];
  licenses: DependencyLicenseEntry[];
  /** Added in v1.1.0. */
  luts?: DependencyLutEntry[];
  /** Added in v1.1.0. */
  expressions?: DependencyExpressionEntry[];
  /** Added in v1.1.0. */
  assets?: DependencyAssetEntry[];
}

export function createDependencyContract(
  payload: Omit<DependencyContract, keyof ContractEnvelope>,
  version: string = DEPENDENCY_CONTRACT_VERSION,
): DependencyContract {
  return {
    ...createContractEnvelope(ContractSchemaName.DEPENDENCY, version),
    ...payload,
  };
}

export class DependencySerializer extends JsonContractSerializer<DependencyContract> {}

export class DependencyValidator extends BaseContractValidator<DependencyContract> {
  constructor() {
    super('Dependency', ContractSchemaName.DEPENDENCY);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    const requiredSections = ['fonts', 'plugins', 'presets', 'scripts', 'licenses'];

    const version = typeof record.version === 'string' ? record.version : '1.0.0';
    const parsed = parseContractVersion(version);
    const isV1_1OrLater = parsed.major > 1 || (parsed.major === 1 && parsed.minor >= 1);

    if (isV1_1OrLater) {
      requiredSections.push('luts', 'expressions', 'assets');
    }

    for (const section of requiredSections) {
      if (!Array.isArray(record[section])) {
        issues.push(`${section} must be an array`);
      }
    }

    return issues;
  }
}
