import type { CachedNode } from '../node-registry.types.js';
import type { SchedulingRequirement } from '../scheduling-requirement.types.js';
import type { NodeScore } from '../node-scoring.service.js';

export interface NodeSelectionResult {
  node: CachedNode | null;
  scores: NodeScore[];
}

/**
 * Open/Closed by design: adding a new strategy means adding a new class
 * that implements this interface — RenderBrokerService, JobScheduler, and
 * every existing strategy stay untouched. `candidates` is always already
 * capability-filtered (matchesCapability() ran first) — a strategy only
 * ever ranks nodes that can actually do the job, never decides eligibility
 * itself.
 */
export interface INodeSelectionStrategy {
  readonly name: string;
  select(candidates: CachedNode[], requirement: SchedulingRequirement): NodeSelectionResult;
}
