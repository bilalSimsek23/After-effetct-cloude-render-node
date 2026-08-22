import { resolve } from 'node:path';
import { copyDirectoryContents } from '../../utils/copy-directory-contents.js';
import type { Logger } from '../../types/log.types.js';
import type { FontInstallResult } from './dependency-package.types.js';

export interface IFontInstallerService {
  installFonts(extractedDir: string): Promise<FontInstallResult>;
}

/**
 * Copies every file from an extracted dependency package's fonts/ folder
 * into the node's configured fonts directory (production default:
 * ~/Library/Fonts, but this is injected — never hardcoded — so tests can
 * point it somewhere safe). No mapping from dependencies.json's font
 * entries to filenames is attempted: the manifest only describes
 * family/style, not a filename, so installation is driven entirely by
 * what's actually in the fonts/ folder.
 */
export class FontInstallerService implements IFontInstallerService {
  constructor(
    private readonly fontsDirectory: string,
    private readonly logger: Logger,
  ) {}

  async installFonts(extractedDir: string): Promise<FontInstallResult> {
    const result = await copyDirectoryContents(resolve(extractedDir, 'fonts'), this.fontsDirectory);

    this.logger.info('Fontlar kuruldu', {
      fontsDirectory: this.fontsDirectory,
      installed: result.copied,
      skipped: result.skipped,
    });

    return { installed: result.copied, skipped: result.skipped };
  }
}
