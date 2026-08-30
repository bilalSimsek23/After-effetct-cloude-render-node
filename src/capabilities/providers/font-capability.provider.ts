import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Logger } from '../../types/log.types.js';
import type { ICapabilityProvider } from '../capability-provider.interface.js';

/**
 * Reports installed fonts as a single version/hash, never as an
 * individual file listing (per spec). Derived from the existing
 * Dependency Package cache file (read-only — Dependency Package code
 * itself is untouched this phase): if that file's contents change (a new
 * font package got installed for some template), the hash changes too.
 */
export class FontCapabilityProvider implements ICapabilityProvider<string | null> {
  readonly name = 'font';

  constructor(
    private readonly dependencyCacheFilePath: string,
    private readonly logger: Logger,
  ) {}

  async collect(): Promise<string | null> {
    try {
      const raw = await readFile(this.dependencyCacheFilePath, 'utf-8');
      return createHash('sha256').update(raw).digest('hex').slice(0, 16);
    } catch (error) {
      this.logger.debug('Font package cache not found, fontPackageVersion returns null', {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
