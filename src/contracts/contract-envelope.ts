/**
 * Every JSON payload that crosses a service boundary (Laravel, Render
 * Node, Scanner, After Effects, future AI Studio, ...) is one of these
 * named schemas. No service invents its own schema name string — they
 * all come from this one const object.
 */
export const ContractSchemaName = {
  MANIFEST: 'manifest',
  TEMPLATE_VARIABLE: 'template-variable',
  SCANNER_RESULT: 'scanner-result',
  DEPENDENCY: 'dependency',
  ASSET: 'asset',
  RENDER_PROFILE: 'render-profile',
  RENDER_JOB: 'render-job',
  RENDER_RESULT: 'render-result',
  RENDER_PROGRESS: 'render-progress',
  RENDER_NODE: 'render-node',
  SYSTEM_STATUS: 'system-status',
  ADOBE_ENVIRONMENT: 'adobe-environment',
  WORKSPACE: 'workspace',
  JOB_CLAIM: 'job-claim',
  JOB_LEASE: 'job-lease',
  JOB_HEARTBEAT: 'job-heartbeat',
  CAPABILITY_REPORT: 'capability-report',
} as const;

export type ContractSchemaName = (typeof ContractSchemaName)[keyof typeof ContractSchemaName];

/**
 * The envelope every Contract carries, regardless of payload. `schema`
 * identifies which Contract this is; `version` is that Contract's own
 * semver (independent per schema, so one Contract can evolve without
 * forcing changes on any other); `createdAt` is when this particular
 * payload instance was produced.
 */
export interface ContractEnvelope<TSchema extends ContractSchemaName = ContractSchemaName> {
  schema: TSchema;
  version: string;
  createdAt: string;
}

/**
 * The one place an envelope is ever stamped. No service hand-builds
 * `{ schema, version, createdAt, ... }` itself — every Contract factory
 * calls this instead.
 */
export function createContractEnvelope<TSchema extends ContractSchemaName>(
  schema: TSchema,
  version: string,
): ContractEnvelope<TSchema> {
  return { schema, version, createdAt: new Date().toISOString() };
}
