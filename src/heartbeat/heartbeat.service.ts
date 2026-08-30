import type { IApiClient } from '../api/api-client.interface.js';
import type { NodeInfoService } from '../services/node-info.service.js';
import type { JobRuntimeStats } from './job-runtime-stats.interface.js';
import type { Logger } from '../types/log.types.js';
import type { RenderNodeConfig } from '../types/config.types.js';
import { retryWithBackoff } from '../utils/retry.js';

const HEARTBEAT_RETRIES = 2;
const HEARTBEAT_RETRY_DELAY_MS = 1000;

/**
 * Sends a heartbeat every `config.heartbeatInterval` seconds. Uses a
 * self-rescheduling timeout (not setInterval) so a slow or retried
 * heartbeat can never overlap with the next one.
 *
 * Only sends the lean, dynamic metrics payload (uptime, memory, running
 * jobs, versions) — the static node info (hostname, CPU, platform) was
 * already sent once at register() and is never resent.
 */
export class HeartbeatService {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly apiClient: IApiClient,
    private readonly nodeInfoService: NodeInfoService,
    private readonly jobRuntimeStats: JobRuntimeStats,
    private readonly logger: Logger,
    private readonly config: RenderNodeConfig,
  ) {}

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private scheduleNext(): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.tick();
    }, this.config.heartbeatInterval * 1000);
  }

  private async tick(): Promise<void> {
    try {
      const metrics = this.nodeInfoService.collectHeartbeatMetrics({
        runningJobs: this.jobRuntimeStats.getRunningJobCount(),
        maxConcurrentJobs: this.config.maxConcurrentJobs,
        agentVersion: this.config.agentVersion,
      });

      await retryWithBackoff(() => this.apiClient.heartbeat(metrics), {
        retries: HEARTBEAT_RETRIES,
        initialDelayMs: HEARTBEAT_RETRY_DELAY_MS,
        logger: this.logger,
        label: 'Heartbeat',
      });

      this.logger.info('Heartbeat sent', {
        uptimeSeconds: metrics.uptimeSeconds,
        runningJobs: metrics.runningJobs,
        memoryUsagePercent: metrics.memory.usagePercent,
      });
    } catch (error) {
      this.logger.error('Failed to send heartbeat', { error: (error as Error).message });
    } finally {
      this.scheduleNext();
    }
  }
}
