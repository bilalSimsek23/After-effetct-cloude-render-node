import { SystemReadyStatus } from '../types/system-status.types.js';
import type { NodeRegistrationService } from './node-registration.service.js';
import type { HeartbeatLoop } from './heartbeat-loop.js';
import type { CapabilityLoop } from './capability-loop.js';
import type { PushServer } from './push-server.js';
import type { ITunnelService } from './cloudflare-tunnel.service.js';
import type { IHealthService } from '../services/health.service.js';
import type { AdobeRuntimeService } from '../adobe/runtime/adobe-runtime.service.js';
import type { ILaravelApiClient } from '../api/laravel-api.client.js';
import type { Logger } from '../types/log.types.js';

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000;

/**
 * The Render Node's single entry point (spec: "Bu sınıf sistemin tek giriş
 * noktası olacaktır"). Sequences the Node Lifecycle exactly once — Node
 * Start → NodeRegistrationService (Environment Check → Adobe Runtime
 * initialize() → Capability collect(), purely local - node identity itself
 * is pre-provisioned, see AuthService) → READY → Heartbeat Loop +
 * Cloudflare Tunnel + Push Server — then owns graceful shutdown. Contains
 * zero render, scheduling, or retry logic itself; every real decision
 * lives in the services it composes.
 */
export class NodeRunner {
  private healthCheckTimer: NodeJS.Timeout | undefined;
  private lastHealthy: boolean | null = null;
  private shuttingDown = false;

  constructor(
    private readonly nodeRegistrationService: NodeRegistrationService,
    private readonly heartbeatLoop: HeartbeatLoop,
    private readonly capabilityLoop: CapabilityLoop,
    private readonly cloudflareTunnel: ITunnelService,
    private readonly pushServer: PushServer,
    private readonly healthService: IHealthService,
    private readonly adobeRuntimeService: AdobeRuntimeService,
    private readonly laravelApiClient: ILaravelApiClient,
    private readonly logger: Logger,
    private readonly healthCheckIntervalMs: number = DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  ) {}

  async start(): Promise<void> {
    await this.nodeRegistrationService.register();
    this.logger.info('Node READY');

    this.heartbeatLoop.start();
    this.capabilityLoop.start();
    // Tunnel must be up before the push server starts accepting requests
    // through it - Laravel's callback_url only resolves once the tunnel
    // has registered its connection with Cloudflare's edge.
    await this.cloudflareTunnel.start();
    await this.pushServer.start();
    this.scheduleHealthCheck();

    this.logger.info('Render Node çalışıyor (Production Orchestrator)');
  }

  async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    this.logger.info(`Kapatma sinyali alındı (${signal}), servisler sırayla durduruluyor`);

    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
    }

    await this.pushServer.stop();
    await this.cloudflareTunnel.stop();
    this.heartbeatLoop.stop();
    this.capabilityLoop.stop();
    // disposeAdobeSessions() → AdobeRuntime.shutdown() (shutdown() already
    // disposes every active AdobeSession itself, first thing it does — see
    // Phase 2/3's AdobeRuntimeService, untouched — so there is no separate
    // step to add here).
    await this.adobeRuntimeService.shutdown();
    // notifyNodeOffline()
    await this.notifyOffline();

    this.logger.info('Render Node kapatıldı');
  }

  private scheduleHealthCheck(): void {
    this.healthCheckTimer = setTimeout(
      () => void this.runHealthCheck(),
      this.healthCheckIntervalMs,
    );
  }

  private async runHealthCheck(): Promise<void> {
    try {
      const result = await this.healthService.checkHealth();

      if (this.lastHealthy !== result.healthy) {
        this.lastHealthy = result.healthy;
        await this.laravelApiClient.reportSystemStatus({
          status: result.healthy ? SystemReadyStatus.READY : SystemReadyStatus.NOT_READY,
          errors: result.healthy
            ? []
            : Object.entries(result.checks)
                .filter(([, ok]) => !ok)
                .map(([check]) => check),
        });
        this.logger.info("Sağlık durumu değişti, Laravel'e bildirildi", {
          healthy: result.healthy,
          checks: result.checks,
        });
      }
    } catch (error) {
      this.logger.error('Health check çalıştırılamadı', { error: (error as Error).message });
    } finally {
      if (!this.shuttingDown) {
        this.scheduleHealthCheck();
      }
    }
  }

  /**
   * SystemReadyStatus (the shape IApiClient.reportSystemStatus() already
   * accepts) only has READY/NOT_READY — no OFFLINE value — so shutdown
   * reports NOT_READY, the closest existing signal that this node should
   * no longer be considered for new work.
   *
   * Note: Laravel has no endpoint backing reportSystemStatus() yet (see
   * CapabilityLoop's docblock for the same category of gap) - this call is
   * expected to fail against production today and is caught below.
   */
  private async notifyOffline(): Promise<void> {
    try {
      await this.laravelApiClient.reportSystemStatus({
        status: SystemReadyStatus.NOT_READY,
        errors: [],
      });
    } catch (error) {
      this.logger.error('Node OFFLINE bildirimi başarısız oldu', {
        error: (error as Error).message,
      });
    }
  }
}
