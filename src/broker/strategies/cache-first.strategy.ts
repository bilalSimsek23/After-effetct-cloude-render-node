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
  [ScoringCriterion.RUNNING_JOBS]: 1,
  [ScoringCriterion.MAX_CONCURRENT_JOBS]: 0.5,
  [ScoringCriterion.CPU_LOAD]: 0.5,
  [ScoringCriterion.MEMORY_USAGE]: 0.5,
  [ScoringCriterion.CACHE_MATCH]: 3,
  [ScoringCriterion.TEMPLATE_MATCH]: 2,
  [ScoringCriterion.FONT_PACKAGE_MATCH]: 0.5,
  [ScoringCriterion.PLUGIN_MATCH]: 0.5,
  [ScoringCriterion.RENDER_PROFILE_MATCH]: 0.5,
};

/** Prefers whichever capable node is already generally cache-warm (has recently processed the most distinct templates), load a secondary concern. */
export class CacheFirstStrategy implements INodeSelectionStrategy {
  readonly name = 'CacheFirstStrategy';

  constructor(private readonly scoringService: NodeScoringService) {}

  select(candidates: CachedNode[], requirement: SchedulingRequirement): NodeSelectionResult {
    const scores = candidates.map((candidate) =>
      this.scoringService.score(candidate, requirement, WEIGHTS),
    );
    return pickHighestScoring(candidates, scores);
  }
}
