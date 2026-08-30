import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';
import { RenderProfileCode } from './render-profile.contract.js';

export const CAPABILITY_REPORT_CONTRACT_VERSION = '1.0.0';

export const SupportedFormat = {
  AEP: 'AEP',
  MOGRT: 'MOGRT',
  PRPROJ: 'PRPROJ',
  MOV: 'MOV',
  MP4: 'MP4',
  PNG_SEQUENCE: 'PNG_SEQUENCE',
  WEBM: 'WEBM',
} as const;

export type SupportedFormat = (typeof SupportedFormat)[keyof typeof SupportedFormat];

export const PluginLicenseStatus = {
  LICENSED: 'licensed',
  TRIAL: 'trial',
  UNLICENSED: 'unlicensed',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown',
} as const;

export type PluginLicenseStatus = (typeof PluginLicenseStatus)[keyof typeof PluginLicenseStatus];

export interface CapabilityInstalledPluginEntry {
  name: string;
  version: string;
  licenseStatus: PluginLicenseStatus;
}

export interface CapabilityAdobeInfo {
  afterEffectsVersion: string | null;
  mediaEncoderVersion: string | null;
  dynamicLinkAvailable: boolean;
}

export interface CapabilityHardwareInfo {
  cpuModel: string;
  cpuCores: number;
  ramTotalBytes: number;
  gpuModel: string | null;
  gpuMemoryBytes: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

export interface CapabilityPerformanceInfo {
  maxConcurrentJobs: number;
  currentRunningJobs: number;
  maxQueueLength: number;
}

/**
 * What one Render Node tells Laravel it can do. Sent in full only on
 * first boot or when the node's own capabilities change — never
 * resent inside every heartbeat (see Job Heartbeat Contract for the
 * lean, per-tick metrics instead). Fonts are reported by package
 * version/hash, never as an individual file listing.
 */
export interface CapabilityReportContract extends ContractEnvelope<
  typeof ContractSchemaName.CAPABILITY_REPORT
> {
  nodeUuid: string;
  nodeName: string;
  hostname: string;
  operatingSystem: string;
  architecture: string;
  adobe: CapabilityAdobeInfo;
  supportedEngines: string[];
  supportedRenderProfiles: RenderProfileCode[];
  fontPackageVersion: string | null;
  installedPlugins: CapabilityInstalledPluginEntry[];
  supportedFormats: SupportedFormat[];
  hardware: CapabilityHardwareInfo;
  performance: CapabilityPerformanceInfo;
}

export function createCapabilityReportContract(
  payload: Omit<CapabilityReportContract, keyof ContractEnvelope>,
  version: string = CAPABILITY_REPORT_CONTRACT_VERSION,
): CapabilityReportContract {
  return {
    ...createContractEnvelope(ContractSchemaName.CAPABILITY_REPORT, version),
    ...payload,
  };
}

export class CapabilityReportSerializer extends JsonContractSerializer<CapabilityReportContract> {}

export class CapabilityReportValidator extends BaseContractValidator<CapabilityReportContract> {
  constructor() {
    super('CapabilityReport', ContractSchemaName.CAPABILITY_REPORT);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    for (const field of ['nodeUuid', 'nodeName', 'hostname', 'operatingSystem', 'architecture']) {
      if (typeof record[field] !== 'string' || record[field] === '') {
        issues.push(`${field} must be a non-empty string`);
      }
    }
    if (typeof record.adobe !== 'object' || record.adobe === null)
      issues.push('adobe must be an object');
    if (!Array.isArray(record.supportedEngines)) issues.push('supportedEngines must be an array');
    if (!Array.isArray(record.supportedRenderProfiles))
      issues.push('supportedRenderProfiles must be an array');
    if (!Array.isArray(record.installedPlugins)) issues.push('installedPlugins must be an array');
    if (!Array.isArray(record.supportedFormats)) issues.push('supportedFormats must be an array');
    if (typeof record.hardware !== 'object' || record.hardware === null)
      issues.push('hardware must be an object');
    if (typeof record.performance !== 'object' || record.performance === null) {
      issues.push('performance must be an object');
    }
    return issues;
  }
}
