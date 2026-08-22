import { createWorkspaceContract } from '../contracts/workspace.contract.js';
import type { WorkspaceContract } from '../contracts/workspace.contract.js';
import type { JobWorkspacePaths } from '../adobe/runtime/adobe-workspace.service.js';

/** The one place a JobWorkspacePaths is turned into its Contract shape — never assembled ad hoc by a caller. */
export function mapJobWorkspaceToContract(paths: JobWorkspacePaths): WorkspaceContract {
  return createWorkspaceContract({
    jobUuid: paths.jobUuid,
    workspace: paths.root,
    source: paths.source,
    preview: paths.preview,
    master: paths.master,
    cache: paths.cache,
    logs: paths.logs,
    dependency: paths.dependency,
    extracted: paths.extracted,
    manifest: paths.manifest,
    variables: paths.variables,
    assets: paths.assets,
  });
}
