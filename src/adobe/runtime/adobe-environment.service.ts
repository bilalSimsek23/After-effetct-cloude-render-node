import type { IAfterEffectsEngine } from '../engines/after-effects.engine.js';
import type { IRenderEngine } from '../engines/after-effects-render.engine.js';
import type { AdobeWorkspaceService } from './adobe-workspace.service.js';
import type { Logger } from '../../types/log.types.js';
import type { AdobeAppInfo } from '../models/adobe-app-info.types.js';
import type { EnvironmentCheckResult } from '../models/environment-check.types.js';
import { SystemReadyStatus } from '../models/environment-check.types.js';

/**
 * Runs every check the node's readiness actually depends on: After
 * Effects installed, and the workspace directories exist (creating them
 * if not).
 *
 * Media Encoder's install status is still reported (some Contract
 * consumers — Laravel, dashboards — may still want to know it's there)
 * but, since Faz 8B, is never a reason to report NOT_READY: rendering
 * goes entirely through After Effects' own render queue now (see
 * AfterEffectsRenderEngine's own note on why Media Encoder was dropped
 * from the render path, and docs/adobe-platform-constraints.md), so a
 * node without Media Encoder installed — or with a mismatched version —
 * can still render real jobs correctly. Requiring it anyway would have
 * refused to start nodes that are perfectly capable of working.
 */
export class AdobeEnvironmentService {
  constructor(
    private readonly afterEffectsEngine: IAfterEffectsEngine,
    private readonly renderEngine: IRenderEngine,
    private readonly workspaceService: AdobeWorkspaceService,
    private readonly logger: Logger,
  ) {}

  async check(): Promise<EnvironmentCheckResult> {
    this.logger.info('Environment Check başladı');

    const errors: string[] = [];

    const afterEffects = await this.inspectApp(this.afterEffectsEngine, 'Adobe After Effects');
    if (!afterEffects.installed) {
      errors.push('Adobe After Effects bulunamadı');
    }

    // Reported for Contract consumers, never gates readiness — see class
    // doc comment.
    const mediaEncoder = await this.inspectApp(this.renderEngine, 'Adobe Media Encoder');
    const sameMajorVersionFamily = this.isSameMajorVersionFamily(
      afterEffects.version,
      mediaEncoder.version,
    );
    const dynamicLinkAvailable =
      afterEffects.installed && mediaEncoder.installed && sameMajorVersionFamily;

    let workspaceReady = true;
    try {
      await this.workspaceService.ensure();
    } catch (error) {
      workspaceReady = false;
      errors.push(`Workspace oluşturulamadı: ${(error as Error).message}`);
    }

    const status = errors.length === 0 ? SystemReadyStatus.READY : SystemReadyStatus.NOT_READY;

    const result: EnvironmentCheckResult = {
      status,
      errors,
      afterEffects,
      mediaEncoder,
      sameMajorVersionFamily,
      dynamicLinkAvailable,
      workspaceReady,
    };

    if (status === SystemReadyStatus.READY) {
      this.logger.info('Environment Check başarılı', {
        afterEffectsVersion: afterEffects.version,
        mediaEncoderVersion: mediaEncoder.version,
        dynamicLinkAvailable,
      });
    } else {
      this.logger.error('Environment Check başarısız', { errors });
    }

    return result;
  }

  private async inspectApp(
    engine: { isInstalled(): Promise<boolean>; getVersion(): Promise<string | null> },
    label: string,
  ): Promise<AdobeAppInfo> {
    const installed = await engine.isInstalled();
    const version = installed ? await engine.getVersion() : null;

    if (installed) {
      this.logger.info(`${label} bulundu`, { version });
    }

    return { installed, version };
  }

  private isSameMajorVersionFamily(aeVersion: string | null, meVersion: string | null): boolean {
    if (!aeVersion || !meVersion) {
      return false;
    }

    const aeMajor = aeVersion.split('.')[0];
    const meMajor = meVersion.split('.')[0];

    return aeMajor !== undefined && aeMajor === meMajor;
  }
}
