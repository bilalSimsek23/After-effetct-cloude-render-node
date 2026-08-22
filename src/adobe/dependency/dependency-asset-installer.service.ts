import { resolve } from 'node:path';
import { copyDirectoryContents } from '../../utils/copy-directory-contents.js';
import type { Logger } from '../../types/log.types.js';
import type { JobWorkspacePaths } from '../runtime/adobe-workspace.service.js';
import type { AssetInstallResult } from './dependency-package.types.js';

export interface IDependencyAssetInstallerService {
  installAssets(extractedDir: string, jobWorkspace: JobWorkspacePaths): Promise<AssetInstallResult>;
}

/**
 * Stages an extracted dependency package's assets/ folder (generic
 * project resources: images, footage, ...) into the job's own workspace —
 * unlike fonts/presets/luts/expressions (shared, node-wide), assets are
 * scoped to this one job, same reasoning as ScriptPreparerService.
 */
export class DependencyAssetInstallerService implements IDependencyAssetInstallerService {
  constructor(private readonly logger: Logger) {}

  async installAssets(
    extractedDir: string,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<AssetInstallResult> {
    const assetsDirectory = resolve(jobWorkspace.dependency, 'assets');
    const result = await copyDirectoryContents(resolve(extractedDir, 'assets'), assetsDirectory);

    this.logger.info('Bağımlılık paketi asset’leri job workspace içine hazırlandı', {
      jobUuid: jobWorkspace.jobUuid,
      assetsDirectory,
      installed: result.copied,
      skipped: result.skipped,
    });

    return { installed: result.copied, skipped: result.skipped, assetsDirectory };
  }
}
