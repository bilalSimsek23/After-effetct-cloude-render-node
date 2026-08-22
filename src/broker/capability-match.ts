import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { SchedulingRequirement } from './scheduling-requirement.types.js';

/**
 * The Broker's own capability-matching predicate — deliberately
 * independent from CapabilityRegistry.supports(), which is a node-scoped
 * instance method tied to that class's own hardware/provider DI graph and
 * is not to be touched this phase ("hiçbir mevcut servis yeniden
 * yazılmayacaktır"). The check itself is the same shape (engine, render
 * profile, font package, plugins) because both answer the same real
 * question — "can this report satisfy this requirement" — just from two
 * different callers (a node checking itself vs. a central Broker checking
 * many remote reports).
 */
export function matchesCapability(
  report: CapabilityReportContract,
  requirement: SchedulingRequirement,
): boolean {
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
