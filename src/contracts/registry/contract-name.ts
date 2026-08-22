/**
 * Registry keys. No service ever writes a raw string like "Manifest
 * Contract" to look one up — they import this instead.
 */
export const ContractName = {
  MANIFEST: 'Manifest Contract',
  TEMPLATE_VARIABLE: 'Template Variable Contract',
  SCANNER_RESULT: 'Scanner Result Contract',
  DEPENDENCY: 'Dependency Contract',
  ASSET: 'Asset Contract',
  RENDER_PROFILE: 'Render Profile Contract',
  RENDER_JOB: 'Render Job Contract',
  RENDER_RESULT: 'Render Result Contract',
  RENDER_PROGRESS: 'Render Progress Contract',
  RENDER_NODE: 'Render Node Contract',
  SYSTEM_STATUS: 'System Status Contract',
  ADOBE_ENVIRONMENT: 'Adobe Environment Contract',
  WORKSPACE: 'Workspace Contract',
  JOB_CLAIM: 'Job Claim Contract',
  JOB_LEASE: 'Job Lease Contract',
  JOB_HEARTBEAT: 'Job Heartbeat Contract',
  CAPABILITY_REPORT: 'Capability Report Contract',
} as const;

export type ContractName = (typeof ContractName)[keyof typeof ContractName];
