import type { ProcessManager } from '../bridge/process-manager.js';
import type { Logger } from '../../types/log.types.js';
import type { CloudFontActivationResult } from './dependency-package.types.js';

export interface ICloudFontActivatorService {
  activateCloudFonts(links: string[]): Promise<CloudFontActivationResult>;
}

/**
 * Adobe Fonts (or a similar cloud-activated font service) fonts can't be
 * bundled/redistributed as ordinary font files - they're license-gated and
 * only become usable once activated on a specific Creative Cloud account.
 * dependencies.json carries the font's own page link instead of a file for
 * these (see DependencyManifest.cloudFontLinks); this service opens each
 * one in the default browser before a render starts, so the operator can
 * activate it on this machine's own Creative Cloud account with one click
 * instead of only discovering the gap mid-render (FONT_NOT_AVAILABLE, deep
 * inside apply-variables.jsx, on a real buyer's job).
 *
 * Best-effort only: opening a browser tab can't itself confirm activation
 * succeeded (that still needs a human, at least the first time a given
 * font is seen on this machine) - so a failure to open never fails
 * dependency verification, only gets logged loudly. Only http(s) links are
 * ever passed to `open` - Laravel already validates this manifest field is
 * a real URL, but this side re-checks independently rather than trusting a
 * downloaded file blindly (same principle DependencyManifestReader's own
 * docblock states).
 */
export class CloudFontActivatorService implements ICloudFontActivatorService {
  constructor(
    private readonly processManager: ProcessManager,
    private readonly logger: Logger,
  ) {}

  async activateCloudFonts(links: string[]): Promise<CloudFontActivationResult> {
    const opened: string[] = [];
    const failed: string[] = [];

    for (const link of links) {
      if (!this.isHttpUrl(link)) {
        this.logger.error('Cloud font linki http(s) değil, atlanıyor', { link });
        failed.push(link);
        continue;
      }

      try {
        await this.processManager.openUrl(link);
        opened.push(link);
      } catch (error) {
        this.logger.error('Cloud font linki açılamadı', { link, error: (error as Error).message });
        failed.push(link);
      }
    }

    if (opened.length > 0) {
      this.logger.warn(
        'Cloud font linkleri tarayıcıda açıldı - bu makinenin Creative Cloud hesabında etkinleştirilmesi gerekebilir',
        { opened },
      );
    }
    if (failed.length > 0) {
      this.logger.error('Bazı cloud font linkleri açılamadı - manuel kontrol gerekli', { failed });
    }

    return { opened, failed };
  }

  private isHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
