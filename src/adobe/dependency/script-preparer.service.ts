import { resolve } from 'node:path';
import { copyDirectoryContents } from '../../utils/copy-directory-contents.js';
import type { Logger } from '../../types/log.types.js';
import type { JobWorkspacePaths } from '../runtime/adobe-workspace.service.js';
import type { ScriptPrepareResult } from './dependency-package.types.js';

export interface IScriptPreparerService {
  prepareScripts(
    extractedDir: string,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<ScriptPrepareResult>;
}

/**
 * Copies script files into the job's own workspace (temp/scripts), not a
 * shared node-level location: unlike fonts/presets (shared, node-wide,
 * idempotent), each job needs its own copy since job workspaces are
 * isolated and get cleaned up independently.
 */
export class ScriptPreparerService implements IScriptPreparerService {
  constructor(private readonly logger: Logger) {}

  async prepareScripts(
    extractedDir: string,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<ScriptPrepareResult> {
    const scriptsDirectory = resolve(jobWorkspace.temp, 'scripts');
    const result = await copyDirectoryContents(resolve(extractedDir, 'scripts'), scriptsDirectory);

    this.logger.info('Scripts prepared into job workspace', {
      jobUuid: jobWorkspace.jobUuid,
      scriptsDirectory,
      prepared: result.copied,
      skipped: result.skipped,
    });

    return { prepared: result.copied, skipped: result.skipped, scriptsDirectory };
  }
}
