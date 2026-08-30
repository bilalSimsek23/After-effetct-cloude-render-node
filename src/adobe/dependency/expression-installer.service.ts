import { resolve } from 'node:path';
import { copyDirectoryContents } from '../../utils/copy-directory-contents.js';
import type { Logger } from '../../types/log.types.js';
import type { ExpressionInstallResult } from './dependency-package.types.js';

export interface IExpressionInstallerService {
  installExpressions(extractedDir: string): Promise<ExpressionInstallResult>;
}

/**
 * Copies every file from an extracted dependency package's expressions/
 * folder into the node's configured expressions directory (injected, not
 * hardcoded) — same shared, node-wide, idempotent pattern as
 * FontInstallerService and PresetInstallerService.
 */
export class ExpressionInstallerService implements IExpressionInstallerService {
  constructor(
    private readonly expressionsDirectory: string,
    private readonly logger: Logger,
  ) {}

  async installExpressions(extractedDir: string): Promise<ExpressionInstallResult> {
    const result = await copyDirectoryContents(
      resolve(extractedDir, 'expressions'),
      this.expressionsDirectory,
    );

    this.logger.info('Expression files installed', {
      expressionsDirectory: this.expressionsDirectory,
      installed: result.copied,
      skipped: result.skipped,
    });

    return { installed: result.copied, skipped: result.skipped };
  }
}
