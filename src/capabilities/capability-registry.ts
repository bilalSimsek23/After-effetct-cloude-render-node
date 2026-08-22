import {
  createCapabilityReportContract,
  type CapabilityReportContract,
  type CapabilityAdobeInfo,
  type CapabilityHardwareInfo,
  type CapabilityInstalledPluginEntry,
  type CapabilityPerformanceInfo,
  type SupportedFormat,
} from '../contracts/capability-report.contract.js';
import type { RenderProfileCode } from '../contracts/render-profile.contract.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import { ContractName } from '../contracts/registry/contract-name.js';
import type { ICapabilityProvider } from './capability-provider.interface.js';
import type { OperatingSystemInfo } from './providers/operating-system-capability.provider.js';
import type { AdobeRuntimeCapabilities } from './providers/adobe-runtime-capability.provider.js';
import type {
  CapabilityRequirement,
  CapabilityComparisonResult,
} from './capability-requirement.types.js';
import type { Logger } from '../types/log.types.js';

export interface CapabilityRegistryProviders {
  adobe: ICapabilityProvider<CapabilityAdobeInfo>;
  hardware: ICapabilityProvider<CapabilityHardwareInfo>;
  font: ICapabilityProvider<string | null>;
  plugin: ICapabilityProvider<CapabilityInstalledPluginEntry[]>;
  renderProfile: ICapabilityProvider<RenderProfileCode[]>;
  operatingSystem: ICapabilityProvider<OperatingSystemInfo>;
}

export interface CapabilityRegistryDependencies {
  nodeUuid: string;
  nodeName: string;
  supportedEngines: string[];
  supportedFormats: SupportedFormat[];
  /** Performance numbers change every tick and come from JobManager, not a provider that does I/O. */
  getPerformance: () => CapabilityPerformanceInfo;
  providers: CapabilityRegistryProviders;
  /**
   * Faz 8B, optional — real Adobe runtime capability probe. Not part of
   * CapabilityReportContract yet (a Contract field addition needs its own
   * versioned, explicitly approved phase); collected once during
   * register(), cached, logged, exposed via getRuntimeCapabilities().
   * Optional so existing callers that don't wire one in keep working
   * unchanged.
   */
  runtimeCapabilityProvider?: ICapabilityProvider<AdobeRuntimeCapabilities>;
  contractRegistry: ContractRegistry;
  logger: Logger;
}

const COMPARABLE_FIELDS: (keyof CapabilityReportContract)[] = [
  'adobe',
  'supportedEngines',
  'supportedRenderProfiles',
  'fontPackageVersion',
  'installedPlugins',
  'supportedFormats',
];

/**
 * Hardware identity fields only — diskFreeBytes (and, in principle,
 * ramTotalBytes under memory pressure) drift constantly on a running
 * machine and must never by themselves count as a "capability changed"
 * event, or update() would report a change on nearly every tick.
 */
const STABLE_HARDWARE_FIELDS: (keyof CapabilityHardwareInfo)[] = [
  'cpuModel',
  'cpuCores',
  'gpuModel',
];

/**
 * Aggregates every CapabilityProvider into one CapabilityReportContract.
 * Depends on ContractRegistry for the report's current version — never
 * hardcodes it — satisfying "Capability Registry Contract Registry'den
 * bağımsız çalışmayacaktır".
 *
 * register()/update() are the only points that actually re-collect from
 * the providers (each a real, possibly I/O-bound operation); getCapabilities()
 * just returns what was last collected, matching the spec's "full report
 * only on first boot or when something changes, never every heartbeat".
 */
export class CapabilityRegistry {
  private lastReport: CapabilityReportContract | null = null;
  private runtimeCapabilities: AdobeRuntimeCapabilities | null = null;

  constructor(private readonly deps: CapabilityRegistryDependencies) {}

  async register(): Promise<CapabilityReportContract> {
    const report = await this.collect();
    this.lastReport = report;
    this.deps.logger.info('Capability Report oluşturuldu', { nodeUuid: this.deps.nodeUuid });

    if (this.deps.runtimeCapabilityProvider) {
      this.runtimeCapabilities = await this.deps.runtimeCapabilityProvider.collect();
      this.deps.logger.info('Adobe Runtime Capabilities tespit edildi', {
        nodeUuid: this.deps.nodeUuid,
        ...this.runtimeCapabilities,
      });
    }

    return report;
  }

  /**
   * Faz 8B — real, one-time Adobe runtime capability info (see
   * CapabilityRegistryDependencies.runtimeCapabilityProvider's own note).
   * `null` until register() has run, or if no provider was wired in.
   */
  getRuntimeCapabilities(): AdobeRuntimeCapabilities | null {
    return this.runtimeCapabilities;
  }

  async update(): Promise<CapabilityReportContract> {
    const report = await this.collect();
    const comparison = this.lastReport
      ? this.compare(this.lastReport, report)
      : { changed: true, changedFields: ['*'] };

    this.lastReport = report;

    if (comparison.changed) {
      this.deps.logger.info('Capability Report güncellendi', {
        nodeUuid: this.deps.nodeUuid,
        changedFields: comparison.changedFields,
      });
    }

    return report;
  }

  getCapabilities(): CapabilityReportContract | null {
    return this.lastReport;
  }

  compare(
    previous: CapabilityReportContract,
    next: CapabilityReportContract,
  ): CapabilityComparisonResult {
    const changedFields = COMPARABLE_FIELDS.filter(
      (field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]),
    );

    const hardwareChanged = STABLE_HARDWARE_FIELDS.some(
      (field) => previous.hardware[field] !== next.hardware[field],
    );
    if (hardwareChanged) {
      changedFields.push('hardware');
    }

    return { changed: changedFields.length > 0, changedFields };
  }

  supports(report: CapabilityReportContract, requirement: CapabilityRequirement): boolean {
    return (
      this.supportsStatic(report, requirement) &&
      report.performance.currentRunningJobs < report.performance.maxConcurrentJobs
    );
  }

  /**
   * Same as supports() but without the capacity clause. Capacity
   * (currentRunningJobs/maxConcurrentJobs) is a live, fast-changing fact —
   * this registry's report is only refreshed on a 5-minute timer
   * (CapabilityLoop), so embedding capacity in that cached snapshot means a
   * job accepted seconds ago (live, correct) can be spuriously rejected by
   * a stale re-check moments later. Callers that already gate on their own
   * live running-job counter before claiming (JobProcessor.handleAssignedJob)
   * must use this method for any post-claim re-validation instead of
   * supports(), so they only re-check what's actually still worth
   * re-checking: engine/profile/font/plugin support.
   */
  supportsStatic(report: CapabilityReportContract, requirement: CapabilityRequirement): boolean {
    if (!report.supportedEngines.includes(requirement.engine)) {
      return false;
    }
    if (!report.supportedRenderProfiles.includes(requirement.renderProfile)) {
      return false;
    }
    if (
      requirement.requiredFontPackageVersion &&
      report.fontPackageVersion !== requirement.requiredFontPackageVersion
    ) {
      return false;
    }
    if (requirement.requiredPlugins && requirement.requiredPlugins.length > 0) {
      const installedNames = new Set(report.installedPlugins.map((plugin) => plugin.name));
      if (!requirement.requiredPlugins.every((name) => installedNames.has(name))) {
        return false;
      }
    }
    return true;
  }

  /** Among nodes that meet the requirement, prefers the one with the most free relative capacity. */
  findBestNode(
    reports: CapabilityReportContract[],
    requirement: CapabilityRequirement,
  ): CapabilityReportContract | null {
    const candidates = reports.filter((report) => this.supports(report, requirement));

    if (candidates.length === 0) {
      return null;
    }

    return candidates.reduce((best, candidate) => {
      const bestLoad = best.performance.currentRunningJobs / best.performance.maxConcurrentJobs;
      const candidateLoad =
        candidate.performance.currentRunningJobs / candidate.performance.maxConcurrentJobs;
      return candidateLoad < bestLoad ? candidate : best;
    });
  }

  private async collect(): Promise<CapabilityReportContract> {
    const { providers } = this.deps;

    const [adobe, hardware, fontPackageVersion, installedPlugins, supportedRenderProfiles, osInfo] =
      await Promise.all([
        providers.adobe.collect(),
        providers.hardware.collect(),
        providers.font.collect(),
        providers.plugin.collect(),
        providers.renderProfile.collect(),
        providers.operatingSystem.collect(),
      ]);

    const version = this.deps.contractRegistry.getCurrentVersion(ContractName.CAPABILITY_REPORT);

    return createCapabilityReportContract(
      {
        nodeUuid: this.deps.nodeUuid,
        nodeName: this.deps.nodeName,
        hostname: osInfo.hostname,
        operatingSystem: osInfo.operatingSystem,
        architecture: osInfo.architecture,
        adobe,
        supportedEngines: this.deps.supportedEngines,
        supportedRenderProfiles,
        fontPackageVersion,
        installedPlugins,
        supportedFormats: this.deps.supportedFormats,
        hardware,
        performance: this.deps.getPerformance(),
      },
      version,
    );
  }
}
