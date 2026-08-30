import { resolve } from 'node:path';
import { copyDirectoryContents } from '../../utils/copy-directory-contents.js';
import type { Logger } from '../../types/log.types.js';
import type { LutInstallResult } from './dependency-package.types.js';

export interface ILutInstallerService {
  installLuts(extractedDir: string): Promise<LutInstallResult>;
}

/**
 * Copies every file from an extracted dependency package's luts/ folder
 * into the node's configured LUTs directory (injected, not hardcoded) —
 * same shared, node-wide, idempotent pattern as FontInstallerService and
 * PresetInstallerService.
 */
export class LutInstallerService implements ILutInstallerService {
  constructor(
    private readonly lutsDirectory: string,
    private readonly logger: Logger,
  ) {}

  async installLuts(extractedDir: string): Promise<LutInstallResult> {
    const result = await copyDirectoryContents(resolve(extractedDir, 'luts'), this.lutsDirectory);

    this.logger.info('LUT files installed', {
      lutsDirectory: this.lutsDirectory,
      installed: result.copied,
      skipped: result.skipped,
    });

    return { installed: result.copied, skipped: result.skipped };
  }
}
