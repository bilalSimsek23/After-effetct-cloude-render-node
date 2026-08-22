import type { NodeInfo } from './node-info.types.js';
import type { SystemReadyStatus } from './system-status.types.js';

/**
 * Request/response DTOs for the future Laravel Cloud Rendering API.
 * The endpoints these map to do not exist yet — ApiClient currently
 * returns mocked versions of these shapes so the rest of the Render
 * Node can be built and tested against a stable contract.
 *
 * None of these carry a node identifier field: ApiClient attaches the
 * current node_uuid to every outgoing request itself (via
 * NodeIdentityService), so callers never have to thread it through.
 */

export interface RegisterRequestPayload {
  agentKey: string;
  nodeName: string;
  nodeInfo: NodeInfo;
}

export interface RegisterResponse {
  success: boolean;
  nodeUuid: string;
}

export interface HeartbeatResponse {
  success: boolean;
}

export interface HeartbeatMemoryUsage {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
}

/** The lean, dynamic-only payload sent on every heartbeat. */
export interface HeartbeatMetrics {
  uptimeSeconds: number;
  memory: HeartbeatMemoryUsage;
  runningJobs: number;
  maxConcurrentJobs: number;
  applicationVersion: string;
  agentVersion: string;
}

export interface JobProgressPayload {
  progressPercent: number;
  message?: string;
}

export interface JobCompletedPayload {
  outputUrl?: string;
}

export interface JobFailedPayload {
  reason: string;
}

/** Reports whether this node is fit to accept work, per the Adobe Environment Check. */
export interface SystemStatusReportPayload {
  status: SystemReadyStatus;
  errors: string[];
}

/** Metadata Laravel reports for a render template's approved dependency package. */
export interface DependencyPackageInfo {
  packageUuid: string;
  packageVersion: number;
  downloadUrl: string;
}
