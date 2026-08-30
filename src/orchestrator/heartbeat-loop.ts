import os from 'node:os';
import { createJobHeartbeatContract } from '../contracts/job-heartbeat.contract.js';
import { ContractName } from '../contracts/registry/contract-name.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import type { ILaravelApiClient } from '../api/laravel-api.client.js';
import type { NodeIdentityService } from '../services/node-identity.service.js';
import type { JobRuntimeStats } from '../heartbeat/job-runtime-stats.interface.js';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { Logger } from '../types/log.types.js';
import { readApplicationVersion } from '../utils/read-application-version.js';

/**
 * A fully independent async loop — never runs inside JobPoller, per spec.
 * Sends only JobHeartbeatContract (dynamic liveness/load numbers);
 * Capability never travels with it (see CapabilityLoop). Same
 * self-rescheduling setTimeout pattern as Phase 1's HeartbeatService (kept
 * untouched) so a slow/retried heartbeat can never overlap the next one.
 */
export class HeartbeatLoop {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private readonly startedAt = Date.now();

  constructor(
    private readonly laravelApiClient: ILaravelApiClient,
    private readonly nodeIdentity: NodeIdentityService,
    private readonly jobRuntimeStats: JobRuntimeStats,
    private readonly contractRegistry: ContractRegistry,
    private readonly config: RenderNodeConfig,
    private readonly logger: Logger,
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
    this.timer = setTimeout(() => void this.tick(), this.config.heartbeatInterval * 1000);
  }

  private async tick(): Promise<void> {
    try {
      const nodeUuid = this.nodeIdentity.getNodeUuid();
      if (!nodeUuid) {
        this.logger.warn('node_uuid not available yet, heartbeat skipped this round');
        return;
      }

      const totalBytes = os.totalmem();
      const freeBytes = os.freemem();
      const usedBytes = totalBytes - freeBytes;
      const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;

      const version = this.contractRegistry.getCurrentVersion(ContractName.JOB_HEARTBEAT);
      const heartbeat = createJobHeartbeatContract(
        {
          nodeUuid,
          uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
          memory: { totalBytes, usedBytes, freeBytes, usagePercent },
          runningJobs: this.jobRuntimeStats.getRunningJobCount(),
          maxConcurrentJobs: this.config.maxConcurrentJobs,
          applicationVersion: readApplicationVersion(),
          agentVersion: this.config.agentVersion,
        },
        version,
      );

      this.contractRegistry.validate(ContractName.JOB_HEARTBEAT, heartbeat);

      await this.laravelApiClient.sendJobHeartbeat(heartbeat);

      this.logger.info('Heartbeat sent (JobHeartbeatContract)', {
        runningJobs: heartbeat.runningJobs,
        memoryUsagePercent: heartbeat.memory.usagePercent,
      });
    } catch (error) {
      this.logger.error('Failed to send heartbeat', { error: (error as Error).message });
    } finally {
      this.scheduleNext();
    }
  }
}
