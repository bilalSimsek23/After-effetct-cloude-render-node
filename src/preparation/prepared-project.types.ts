import type { WorkspaceContract } from '../contracts/workspace.contract.js';

export const PreparedProjectStatus = {
  READY: 'READY',
  FAILED: 'FAILED',
} as const;

export type PreparedProjectStatus =
  (typeof PreparedProjectStatus)[keyof typeof PreparedProjectStatus];

/**
 * The only shape a future Render Engine ever consumes: projectFilePath
 * (the .aep) + variablesFilePath (variables.json) — it does zero
 * preparation work of its own.
 */
export interface PreparedProject {
  jobUuid: string;
  status: PreparedProjectStatus;
  projectFilePath: string | null;
  variablesFilePath: string | null;
  workspace: WorkspaceContract;
  errors: string[];
}
