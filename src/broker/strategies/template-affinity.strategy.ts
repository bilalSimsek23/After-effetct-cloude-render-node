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
  [ScoringCriterion.CACHE_MATCH]: 1,
  [ScoringCriterion.TEMPLATE_MATCH]: 5,
  [ScoringCriterion.FONT_PACKAGE_MATCH]: 0.5,
  [ScoringCriterion.PLUGIN_MATCH]: 0.5,
  [ScoringCriterion.RENDER_PROFILE_MATCH]: 0.5,
};

/** Job Affinity, at its strongest: heavily prefers the exact node that processed this exact templateUuid before, over anything else including current load. */
export class TemplateAffinityStrategy implements INodeSelectionStrategy {
  readonly name = 'TemplateAffinityStrategy';

  constructor(private readonly scoringService: NodeScoringService) {}

  select(candidates: CachedNode[], requirement: SchedulingRequirement): NodeSelectionResult {
    const scores = candidates.map((candidate) =>
      this.scoringService.score(candidate, requirement, WEIGHTS),
    );
    return pickHighestScoring(candidates, scores);
  }
}
