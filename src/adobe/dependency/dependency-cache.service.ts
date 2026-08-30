import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '../../types/log.types.js';

export interface IDependencyCacheService {
  get(renderTemplateUuid: string): Promise<number | null>;
  set(renderTemplateUuid: string, packageVersion: number): Promise<void>;
}

/**
 * Persists "which dependency package version is already extracted for
 * this render template" to a small JSON file, so a restarted Render Node
 * doesn't lose its cache. Keyed exactly as the spec describes:
 * render_template_uuid + dependency_package_version — if the version on
 * record matches, the package is not re-downloaded/re-extracted.
 */
export class DependencyCacheService implements IDependencyCacheService {
  constructor(
    private readonly cacheFilePath: string,
    private readonly logger: Logger,
  ) {}

  async get(renderTemplateUuid: string): Promise<number | null> {
    const cache = await this.readCache();
    return cache[renderTemplateUuid] ?? null;
  }

  async set(renderTemplateUuid: string, packageVersion: number): Promise<void> {
    const cache = await this.readCache();
    cache[renderTemplateUuid] = packageVersion;

    await mkdir(dirname(this.cacheFilePath), { recursive: true });
    await writeFile(this.cacheFilePath, JSON.stringify(cache, null, 2), 'utf-8');

    this.logger.debug('Dependency cache updated', { renderTemplateUuid, packageVersion });
  }

  private async readCache(): Promise<Record<string, number>> {
    try {
      const raw = await readFile(this.cacheFilePath, 'utf-8');
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      return {};
    }
  }
}
