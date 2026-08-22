import type { CachedNode } from './node-registry.types.js';
import type { SchedulingRequirement } from './scheduling-requirement.types.js';

/** The 9 criteria the spec names, each a 0..1 score (higher is always better). */
export const ScoringCriterion = {
  RUNNING_JOBS: 'runningJobs',
  MAX_CONCURRENT_JOBS: 'maxConcurrentJobs',
  CPU_LOAD: 'cpuLoad',
  MEMORY_USAGE: 'memoryUsage',
  CACHE_MATCH: 'cacheMatch',
  TEMPLATE_MATCH: 'templateMatch',
  FONT_PACKAGE_MATCH: 'fontPackageMatch',
  PLUGIN_MATCH: 'pluginMatch',
  RENDER_PROFILE_MATCH: 'renderProfileMatch',
} as const;

export type ScoringCriterion = (typeof ScoringCriterion)[keyof typeof ScoringCriterion];

export type ScoringWeights = Record<ScoringCriterion, number>;

export interface NodeScore {
  nodeUuid: string;
  score: number;
  breakdown: Record<ScoringCriterion, number>;
}

/** A node with no meaningful cache history yet — score(s) fall back to a neutral value, never penalized for being new. */
const CACHE_WARM_REFERENCE_COUNT = 5;
/** Soft reference for "a high-end node" — not a hard cap, just what 1.0 means for this criterion. */
const MAX_CONCURRENT_JOBS_REFERENCE = 8;

/**
 * Computes each of the 9 criteria the spec lists, independently — a
 * Strategy decides how much each one matters by supplying its own
 * ScoringWeights, this service never picks weights itself. All 9 numbers
 * always come from real fields already present on CachedNode (capability
 * report + latest heartbeat + processed-template history) — none are
 * fabricated. There is no live CPU utilization sample anywhere in the
 * platform yet, so CPU_LOAD is honestly a running-jobs-per-core proxy,
 * not a real telemetry reading — documented here rather than pretending
 * otherwise.
 */
export class NodeScoringService {
  score(node: CachedNode, requirement: SchedulingRequirement, weights: ScoringWeights): NodeScore {
    const breakdown: Record<ScoringCriterion, number> = {
      [ScoringCriterion.RUNNING_JOBS]: this.scoreRunningJobs(node),
      [ScoringCriterion.MAX_CONCURRENT_JOBS]: this.scoreMaxConcurrentJobs(node),
      [ScoringCriterion.CPU_LOAD]: this.scoreCpuLoad(node),
      [ScoringCriterion.MEMORY_USAGE]: this.scoreMemoryUsage(node),
      [ScoringCriterion.CACHE_MATCH]: this.scoreCacheMatch(node),
      [ScoringCriterion.TEMPLATE_MATCH]: this.scoreTemplateMatch(node, requirement),
      [ScoringCriterion.FONT_PACKAGE_MATCH]: this.scoreFontPackageMatch(node, requirement),
      [ScoringCriterion.PLUGIN_MATCH]: this.scorePluginMatch(node, requirement),
      [ScoringCriterion.RENDER_PROFILE_MATCH]: this.scoreRenderProfileMatch(node, requirement),
    };

    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1;
    const score =
      Object.entries(breakdown).reduce(
        (sum, [criterion, value]) => sum + value * (weights[criterion as ScoringCriterion] ?? 0),
        0,
      ) / totalWeight;

    return { nodeUuid: node.capability.nodeUuid, score, breakdown };
  }

  private scoreRunningJobs(node: CachedNode): number {
    const performance = node.latestHeartbeat ?? node.capability.performance;
    const running =
      'runningJobs' in performance ? performance.runningJobs : performance.currentRunningJobs;
    const max = performance.maxConcurrentJobs;
    if (max <= 0) {
      return 0;
    }
    return Math.max(0, 1 - running / max);
  }

  private scoreMaxConcurrentJobs(node: CachedNode): number {
    return Math.min(
      node.capability.performance.maxConcurrentJobs / MAX_CONCURRENT_JOBS_REFERENCE,
      1,
    );
  }

  /** Proxy: running jobs per CPU core (no live CPU utilization telemetry exists yet). */
  private scoreCpuLoad(node: CachedNode): number {
    const performance = node.latestHeartbeat ?? node.capability.performance;
    const running =
      'runningJobs' in performance ? performance.runningJobs : performance.currentRunningJobs;
    const cores = node.capability.hardware.cpuCores || 1;
    return Math.max(0, 1 - running / cores);
  }

  private scoreMemoryUsage(node: CachedNode): number {
    if (!node.latestHeartbeat) {
      return 0.5;
    }
    return Math.max(0, 1 - node.latestHeartbeat.memory.usagePercent / 100);
  }

  /** How generally cache-warm this node is (how many distinct templates it has recently processed), not tied to one specific template. */
  private scoreCacheMatch(node: CachedNode): number {
    return Math.min(node.processedTemplateUuids.size / CACHE_WARM_REFERENCE_COUNT, 1);
  }

  /** Has this exact template been processed by this node before — the strongest affinity signal. */
  private scoreTemplateMatch(node: CachedNode, requirement: SchedulingRequirement): number {
    return node.processedTemplateUuids.has(requirement.templateUuid) ? 1 : 0;
  }

  private scoreFontPackageMatch(node: CachedNode, requirement: SchedulingRequirement): number {
    if (!requirement.requiredFontPackageVersion) {
      return 1;
    }
    return node.capability.fontPackageVersion === requirement.requiredFontPackageVersion ? 1 : 0;
  }

  private scorePluginMatch(node: CachedNode, requirement: SchedulingRequirement): number {
    if (!requirement.requiredPlugins || requirement.requiredPlugins.length === 0) {
      return 1;
    }
    const installedNames = new Set(node.capability.installedPlugins.map((plugin) => plugin.name));
    const matched = requirement.requiredPlugins.filter((name) => installedNames.has(name)).length;
    return matched / requirement.requiredPlugins.length;
  }

  private scoreRenderProfileMatch(node: CachedNode, requirement: SchedulingRequirement): number {
    return node.capability.supportedRenderProfiles.includes(requirement.renderProfile) ? 1 : 0;
  }
}
