import type { CachedNode } from '../node-registry.types.js';
import type { NodeScore } from '../node-scoring.service.js';
import type { NodeSelectionResult } from './node-selection-strategy.interface.js';

/** Shared by every strategy: score every candidate, then pick the single highest. Ties keep the first candidate (stable, deterministic). */
export function pickHighestScoring(
  candidates: CachedNode[],
  scores: NodeScore[],
): NodeSelectionResult {
  if (candidates.length === 0) {
    return { node: null, scores: [] };
  }

  const best = scores.reduce((highest, current) =>
    current.score > highest.score ? current : highest,
  );
  const node =
    candidates.find((candidate) => candidate.capability.nodeUuid === best.nodeUuid) ?? null;

  return { node, scores };
}
