import { copyFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import type { ITemplateCacheService } from './template-cache.service.js';
import type { JobWorkspacePaths } from '../adobe/runtime/adobe-workspace.service.js';
import { hashFileSha256 } from '../utils/hash-file.js';
import type { Logger } from '../types/log.types.js';

export class TemplateDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateDownloadError';
  }
}

export interface TemplateDownloadResult {
  projectFilePath: string;
  assetHash: string;
  usedCache: boolean;
}

export interface ITemplateDownloadService {
  download(
    templateUuid: string,
    localAssetFilePath: string,
    jobWorkspace: JobWorkspacePaths,
    expectedHash: string | null,
  ): Promise<TemplateDownloadResult>;
}

/**
 * Stages the already-downloaded project asset (see JobProcessor - it
 * downloads `projectAsset.downloadUrl` before calling
 * ProjectPreparationService.prepare()) into the job's own workspace.
 * `expectedHash` comes straight from the claim response's
 * `projectAsset.checksumSha256` - no separate Laravel round-trip to fetch
 * asset metadata exists in the real API, so none is made here.
 */
export class TemplateDownloadService implements ITemplateDownloadService {
  constructor(
    private readonly cacheService: ITemplateCacheService,
    private readonly logger: Logger,
  ) {}

  async download(
    templateUuid: string,
    localAssetFilePath: string,
    jobWorkspace: JobWorkspacePaths,
    expectedHash: string | null,
  ): Promise<TemplateDownloadResult> {
    const assetHash = await hashFileSha256(localAssetFilePath);

    if (expectedHash && expectedHash !== assetHash) {
      throw new TemplateDownloadError(
        `The project file's SHA-256 checksum does not match the one reported by Laravel (expected: ${expectedHash}, computed: ${assetHash}) - the file may be corrupt or incompletely downloaded.`,
      );
    }

    const cachedHash = await this.cacheService.get(templateUuid);
    const usedCache = cachedHash === assetHash;

    await mkdir(jobWorkspace.source, { recursive: true });
    const projectFilePath = resolve(jobWorkspace.source, basename(localAssetFilePath));
    await copyFile(localAssetFilePath, projectFilePath);

    if (!usedCache) {
      await this.cacheService.set(templateUuid, assetHash);
    }

    this.logger.info('Template asset staged into job workspace', {
      templateUuid,
      projectFilePath,
      assetHash,
      usedCache,
    });

    return { projectFilePath, assetHash, usedCache };
  }
}
