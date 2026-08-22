import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { JobHeartbeatContract } from '../contracts/job-heartbeat.contract.js';

/**
 * What the Broker keeps per node. `capability` is cached and only
 * replaced when the node explicitly reports a real change (Adobe
 * updated, font package changed, ...) — never rebuilt on every heartbeat
 * (see spec's "Capability Cache" section). `latestHeartbeat` carries the
 * live, fast-changing numbers (runningJobs, memory) heartbeats actually
 * update. `processedTemplateUuids` is what Job Affinity / Cache Match
 * scoring reads — updated only when a job on this node actually completes.
 */
export interface CachedNode {
  capability: CapabilityReportContract;
  latestHeartbeat: JobHeartbeatContract | null;
  lastHeartbeatAt: number;
  processedTemplateUuids: Set<string>;
}
