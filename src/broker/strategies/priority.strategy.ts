import type { CachedNode } from '../node-registry.types.js';
import type { SchedulingRequirement } from '../scheduling-requirement.types.js';
import { NodeScoringService, ScoringCriterion } from '../node-scoring.service.js';
import type { ScoringWeights } from '../node-scoring.service.js';
import { RenderJobPriority } from '../../contracts/render-job.contract.js';
import type {
  INodeSelectionStrategy,
  NodeSelectionResult,
} from './node-selection-strategy.interface.js';
import { pickHighestScoring } from './strategy-utils.js';

const HIGH_PRIORITY_WEIGHTS: ScoringWeights = {
  [ScoringCriterion.RUNNING_JOBS]: 4,
  [ScoringCriterion.MAX_CONCURRENT_JOBS]: 1,
  [ScoringCriterion.CPU_LOAD]: 3,
  [ScoringCriterion.MEMORY_USAGE]: 2,
  [ScoringCriterion.CACHE_MATCH]: 0.5,
  [ScoringCriterion.TEMPLATE_MATCH]: 0.5,
  [ScoringCriterion.FONT_PACKAGE_MATCH]: 0.5,
  [ScoringCriterion.PLUGIN_MATCH]: 0.5,
  [ScoringCriterion.RENDER_PROFILE_MATCH]: 0.5,
};

const NORMAL_PRIORITY_WEIGHTS: ScoringWeights = {
  [ScoringCriterion.RUNNING_JOBS]: 2,
  [ScoringCriterion.MAX_CONCURRENT_JOBS]: 1,
  [ScoringCriterion.CPU_LOAD]: 1,
  [ScoringCriterion.MEMORY_USAGE]: 1,
  [ScoringCriterion.CACHE_MATCH]: 1,
  [ScoringCriterion.TEMPLATE_MATCH]: 1,
  [ScoringCriterion.FONT_PACKAGE_MATCH]: 0.5,
  [ScoringCriterion.PLUGIN_MATCH]: 0.5,
  [ScoringCriterion.RENDER_PROFILE_MATCH]: 0.5,
};

const LOW_PRIORITY_WEIGHTS: ScoringWeights = {
  [ScoringCriterion.RUNNING_JOBS]: 1,
  [ScoringCriterion.MAX_CONCURRENT_JOBS]: 0.5,
  [ScoringCriterion.CPU_LOAD]: 0.5,
  [ScoringCriterion.MEMORY_USAGE]: 0.5,
  [ScoringCriterion.CACHE_MATCH]: 3,
  [ScoringCriterion.TEMPLATE_MATCH]: 3,
  [ScoringCriterion.FONT_PACKAGE_MATCH]: 0.5,
  [ScoringCriterion.PLUGIN_MATCH]: 0.5,
  [ScoringCriterion.RENDER_PROFILE_MATCH]: 0.5,
};

/**
 * The only strategy whose weights depend on the Render Job itself, not
 * just the node: HIGH priority jobs care almost entirely about getting
 * the fastest, least-loaded node right now; LOW priority jobs are
 * steered toward already cache-warm nodes instead, preserving headroom
 * elsewhere for urgent work.
 */
export class PriorityStrategy implements INodeSelectionStrategy {
  readonly name = 'PriorityStrategy';

  constructor(private readonly scoringService: NodeScoringService) {}

  select(candidates: CachedNode[], requirement: SchedulingRequirement): NodeSelectionResult {
    const weights = this.weightsFor(requirement.priority);
    const scores = candidates.map((candidate) =>
      this.scoringService.score(candidate, requirement, weights),
    );
    return pickHighestScoring(candidates, scores);
  }

  private weightsFor(priority: RenderJobPriority): ScoringWeights {
    switch (priority) {
      case RenderJobPriority.HIGH:
        return HIGH_PRIORITY_WEIGHTS;
      case RenderJobPriority.LOW:
        return LOW_PRIORITY_WEIGHTS;
      case RenderJobPriority.NORMAL:
        return NORMAL_PRIORITY_WEIGHTS;
      default:
        return NORMAL_PRIORITY_WEIGHTS;
    }
  }
}
