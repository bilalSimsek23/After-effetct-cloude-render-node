import type { NodeInfo } from '../types/node-info.types.js';
import type { RenderJob } from '../types/job.types.js';
import type { AssetContract } from '../contracts/asset.contract.js';
import type {
  RegisterResponse,
  HeartbeatResponse,
  HeartbeatMetrics,
  JobProgressPayload,
  JobCompletedPayload,
  JobFailedPayload,
  SystemStatusReportPayload,
  DependencyPackageInfo,
} from '../types/api.types.js';

/**
 * Contract for talking to the Laravel Cloud Rendering API. HeartbeatService
 * and JobManager depend on this interface, not a concrete implementation —
 * swapping the current mock for a real HTTP client later requires no
 * changes in either of them. Implementations are responsible for attaching
 * the current node_uuid to every call except register() (which is what
 * produces it in the first place).
 */
export interface IApiClient {
  register(nodeInfo: NodeInfo): Promise<RegisterResponse>;
  heartbeat(metrics: HeartbeatMetrics): Promise<HeartbeatResponse>;
  claimJob(): Promise<RenderJob | null>;
  jobProgress(jobUuid: string, payload: JobProgressPayload): Promise<void>;
  jobCompleted(jobUuid: string, payload?: JobCompletedPayload): Promise<void>;
  jobFailed(jobUuid: string, payload: JobFailedPayload): Promise<void>;
  reportSystemStatus(payload: SystemStatusReportPayload): Promise<void>;
  /**
   * Asks Laravel for the currently-approved dependency package for a
   * render template. Returns null if the template has no approved
   * package yet. Only metadata is returned here — actually fetching the
   * ZIP bytes from `downloadUrl` is out of scope for this phase.
   */
  getDependencyPackage(renderTemplateUuid: string): Promise<DependencyPackageInfo | null>;
  /**
   * Added in Phase 4 — asks Laravel for the currently-approved Project
   * asset (.aep/.mogrt) Contract for a render template. Only metadata is
   * returned here — actually fetching the file bytes from `downloadUrl`
   * is out of scope for this phase, same as getDependencyPackage().
   */
  getTemplateAsset(templateUuid: string): Promise<AssetContract>;
}
