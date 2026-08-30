import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '../types/log.types.js';

export interface ITemplateCacheService {
  get(templateUuid: string): Promise<string | null>;
  set(templateUuid: string, assetHash: string): Promise<void>;
}

/**
 * Persists "which Template asset hash is already staged for this render
 * template" to a small JSON file — same persisted-cache-file pattern as
 * DependencyCacheService, kept as its own class since Assets are
 * hash-addressed (not version-addressed like Dependency Packages), so the
 * cached value is a string hash, not a package version number.
 */
export class TemplateCacheService implements ITemplateCacheService {
  constructor(
    private readonly cacheFilePath: string,
    private readonly logger: Logger,
  ) {}

  async get(templateUuid: string): Promise<string | null> {
    const cache = await this.readCache();
    return cache[templateUuid] ?? null;
  }

  async set(templateUuid: string, assetHash: string): Promise<void> {
    const cache = await this.readCache();
    cache[templateUuid] = assetHash;

    await mkdir(dirname(this.cacheFilePath), { recursive: true });
    await writeFile(this.cacheFilePath, JSON.stringify(cache, null, 2), 'utf-8');

    this.logger.debug('Template cache updated', { templateUuid, assetHash });
  }

  private async readCache(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.cacheFilePath, 'utf-8');
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
