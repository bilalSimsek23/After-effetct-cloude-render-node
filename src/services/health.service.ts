import { stat } from 'node:fs/promises';
import type { Logger } from '../types/log.types.js';
import type { HealthCheckResult } from '../types/health.types.js';
import type { AdobeRuntimeService } from '../adobe/runtime/adobe-runtime.service.js';
import type { IAfterEffectsEngine } from '../adobe/engines/after-effects.engine.js';
import type { AdobeWorkspaceService } from '../adobe/runtime/adobe-workspace.service.js';
import type { ICapabilityProvider } from '../capabilities/capability-provider.interface.js';
import type { CapabilityHardwareInfo } from '../contracts/capability-report.contract.js';

export interface IHealthService {
  checkHealth(): Promise<HealthCheckResult>;
}

const MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

/**
 * Real implementation of every check the spec lists — this was
 * intentionally left as a do-nothing stub in an earlier phase specifically
 * awaiting this: Production Orchestration wiring it up to the (equally
 * untouched) services it reads from. Every check is read-only: nothing
 * here launches an app, writes a file, or mutates any state.
 */
export class HealthService implements IHealthService {
  constructor(
    private readonly adobeRuntimeService: AdobeRuntimeService,
    private readonly afterEffectsEngine: IAfterEffectsEngine,
    private readonly workspaceService: AdobeWorkspaceService,
    private readonly hardwareProvider: ICapabilityProvider<CapabilityHardwareInfo>,
    private readonly fontProvider: ICapabilityProvider<string | null>,
    private readonly logger: Logger,
  ) {}

  async checkHealth(): Promise<HealthCheckResult> {
    const checks: Record<string, boolean> = {
      adobeRuntimeReady: this.adobeRuntimeService.isReady(),
      // No mediaEncoderReachable check here: rendering has gone through
      // After Effects' own render queue (RenderQueue.renderAsync()), never
      // Adobe Media Encoder, since Faz 8A (see AfterEffectsRenderEngine's
      // own docblock) - requiring the Media Encoder *app* to be actively
      // running was checking something the render pipeline no longer uses
      // at all, so a node with AE working fine but Media Encoder closed
      // (the normal case) was being reported as globally unhealthy for no
      // real reason. Whether Media Encoder is *installed* is still reported
      // separately and correctly via the Capability Registry
      // (AdobeCapabilityProvider), independent of this per-cycle check.
      afterEffectsReachable: await this.safeCheck(() => this.afterEffectsEngine.isRunning()),
      workspaceAccessible: await this.safeCheck(async () => {
        await stat(this.workspaceService.getPaths().root);
        return true;
      }),
      diskSpaceSufficient: await this.safeCheck(async () => {
        const hardware = await this.hardwareProvider.collect();
        return hardware.diskFreeBytes === null || hardware.diskFreeBytes > MIN_FREE_DISK_BYTES;
      }),
      fontPackageAccessible: await this.safeCheck(async () => {
        await this.fontProvider.collect();
        return true;
      }),
      dependencyCacheAccessible: await this.safeCheck(async () => {
        await stat(this.workspaceService.getPaths().cache);
        return true;
      }),
    };

    const healthy = Object.values(checks).every(Boolean);

    if (!healthy) {
      this.logger.error('Health check: one or more checks failed', { checks });
    }

    return { healthy, checks };
  }

  private async safeCheck(fn: () => Promise<boolean>): Promise<boolean> {
    try {
      return await fn();
    } catch (error) {
      this.logger.debug('Health check failed', {
        error: (error as Error).message,
      });
      return false;
    }
  }
}
