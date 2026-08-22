import { resolve } from 'node:path';
import { copyDirectoryContents } from '../../utils/copy-directory-contents.js';
import type { Logger } from '../../types/log.types.js';
import type { PresetInstallResult } from './dependency-package.types.js';

export interface IPresetInstallerService {
  installPresets(extractedDir: string): Promise<PresetInstallResult>;
}

/**
 * Copies every file from an extracted dependency package's presets/
 * folder into the node's configured Media Encoder presets directory
 * (injected, not hardcoded).
 */
export class PresetInstallerService implements IPresetInstallerService {
  constructor(
    private readonly presetsDirectory: string,
    private readonly logger: Logger,
  ) {}

  async installPresets(extractedDir: string): Promise<PresetInstallResult> {
    const result = await copyDirectoryContents(
      resolve(extractedDir, 'presets'),
      this.presetsDirectory,
    );

    this.logger.info('Render presetleri kuruldu', {
      presetsDirectory: this.presetsDirectory,
      installed: result.copied,
      skipped: result.skipped,
    });

    return { installed: result.copied, skipped: result.skipped };
  }
}
