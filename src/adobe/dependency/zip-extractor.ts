import AdmZip from 'adm-zip';
import { mkdir } from 'node:fs/promises';
import type { Logger } from '../../types/log.types.js';

export interface IZipExtractor {
  extract(zipFilePath: string, destinationDir: string): Promise<void>;
}

/**
 * The only place in the codebase that touches a ZIP container format
 * directly. node:zlib only provides gzip/deflate codecs, not the ZIP
 * archive container itself, so this wraps adm-zip — the project's first
 * runtime dependency.
 */
export class ZipExtractor implements IZipExtractor {
  constructor(private readonly logger: Logger) {}

  async extract(zipFilePath: string, destinationDir: string): Promise<void> {
    await mkdir(destinationDir, { recursive: true });

    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(destinationDir, true);

    this.logger.info('Dependency package extract edildi', { zipFilePath, destinationDir });
  }
}
