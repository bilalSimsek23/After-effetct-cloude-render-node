import type { CachedNode } from '../node-registry.types.js';
import type { SchedulingRequirement } from '../scheduling-requirement.types.js';
import { NodeScoringService, ScoringCriterion } from '../node-scoring.service.js';
import type { ScoringWeights } from '../node-scoring.service.js';
import type {
  INodeSelectionStrategy,
  NodeSelectionResult,
} from './node-selection-strategy.interface.js';
import { pickHighestScoring } from './strategy-utils.js';

const WEIGHTS: ScoringWeights = {
  [ScoringCriterion.RUNNING_JOBS]: 3,
  [ScoringCriterion.MAX_CONCURRENT_JOBS]: 1,
  [ScoringCriterion.CPU_LOAD]: 2,
  [ScoringCriterion.MEMORY_USAGE]: 2,
  [ScoringCriterion.CACHE_MATCH]: 0,
  [ScoringCriterion.TEMPLATE_MATCH]: 0,
  [ScoringCriterion.FONT_PACKAGE_MATCH]: 0.5,
  [ScoringCriterion.PLUGIN_MATCH]: 0.5,
  [ScoringCriterion.RENDER_PROFILE_MATCH]: 0.5,
};

/** Pure load balancing — prefers whichever capable node currently has the most free capacity. Ignores template/cache affinity entirely. */
export class LeastLoadedStrategy implements INodeSelectionStrategy {
  readonly name = 'LeastLoadedStrategy';

  constructor(private readonly scoringService: NodeScoringService) {}

  select(candidates: CachedNode[], requirement: SchedulingRequirement): NodeSelectionResult {
    const scores = candidates.map((candidate) =>
      this.scoringService.score(candidate, requirement, WEIGHTS),
    );
    return pickHighestScoring(candidates, scores);
  }
}
