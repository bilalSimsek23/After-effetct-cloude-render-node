export * from './contract-envelope.js';
export * from './contract-version.js';

export * from './manifest.contract.js';
export * from './template-variable.contract.js';
export * from './scanner-result.contract.js';
export * from './dependency.contract.js';
export * from './asset.contract.js';
export * from './render-profile.contract.js';
export * from './render-job.contract.js';
export * from './render-result.contract.js';
export * from './render-progress.contract.js';
export * from './render-node.contract.js';
export * from './system-status.contract.js';
export * from './adobe-environment.contract.js';
export * from './workspace.contract.js';
export * from './job-lease.contract.js';
export * from './job-claim.contract.js';
export * from './job-heartbeat.contract.js';
export * from './capability-report.contract.js';

export * from './registry/contract-name.js';
export * from './registry/contract-registry.types.js';
export * from './registry/contract-registry.js';
export * from './registry/contract-serializer.js';
export * from './registry/contract-validator.js';
export * from './registry/default-contract-registry.js';

import type { ManifestContract } from './manifest.contract.js';
import type { TemplateVariableContract } from './template-variable.contract.js';
import type { ScannerResultContract } from './scanner-result.contract.js';
import type { DependencyContract } from './dependency.contract.js';
import type { AssetContract } from './asset.contract.js';
import type { RenderProfileContract } from './render-profile.contract.js';
import type { RenderJobContract } from './render-job.contract.js';
import type { RenderResultContract } from './render-result.contract.js';
import type { RenderProgressContract } from './render-progress.contract.js';
import type { RenderNodeContract } from './render-node.contract.js';
import type { SystemStatusContract } from './system-status.contract.js';
import type { AdobeEnvironmentContract } from './adobe-environment.contract.js';
import type { WorkspaceContract } from './workspace.contract.js';
import type { JobClaimContract } from './job-claim.contract.js';
import type { JobLeaseContract } from './job-lease.contract.js';
import type { JobHeartbeatContract } from './job-heartbeat.contract.js';
import type { CapabilityReportContract } from './capability-report.contract.js';

/**
 * Discriminated union (keyed on `schema`) of every Contract in the
 * platform. Adding a new Contract means adding it here too — any
 * exhaustive `switch (contract.schema)` elsewhere in the codebase will
 * then fail to compile until it handles the new case (Open/Closed,
 * enforced by the compiler rather than by convention).
 */
export type PlatformContract =
  | ManifestContract
  | TemplateVariableContract
  | ScannerResultContract
  | DependencyContract
  | AssetContract
  | RenderProfileContract
  | RenderJobContract
  | RenderResultContract
  | RenderProgressContract
  | RenderNodeContract
  | SystemStatusContract
  | AdobeEnvironmentContract
  | WorkspaceContract
  | JobClaimContract
  | JobLeaseContract
  | JobHeartbeatContract
  | CapabilityReportContract;
