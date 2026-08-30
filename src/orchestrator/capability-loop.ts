import type { CapabilityRegistry } from '../capabilities/capability-registry.js';
import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { ILaravelApiClient } from '../api/laravel-api.client.js';
import type { Logger } from '../types/log.types.js';

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class CapabilityLoopNotStartedError extends Error {
  constructor() {
    super(
      'CapabilityLoop.start() cannot run before CapabilityRegistry.register() — no Capability Report has been collected yet.',
    );
    this.name = 'CapabilityLoopNotStartedError';
  }
}

/**
 * Runs on its own schedule, fully independent of HeartbeatLoop — detects
 * capability changes (Adobe version, font package, plugins, render
 * profiles, engine) via CapabilityRegistry.compare(), never on a fixed
 * heartbeat cadence.
 *
 * Render Telemetry & Reliability Foundation — Laravel's capability-report
 * endpoint now exists (POST /api/render-nodes/capability-report); a
 * detected change (or the very first report, right after register()) is
 * actually sent via ILaravelApiClient.sendCapabilityReport(), not just
 * logged. A send failure never crashes the loop (same tolerant pattern as
 * HeartbeatLoop) — it's logged, and the next tick tries again with
 * whatever the registry has collected by then.
 */
export class CapabilityLoop {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private lastSentReport: CapabilityReportContract | null = null;

  constructor(
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly laravelApiClient: ILaravelApiClient,
    private readonly logger: Logger,
    private readonly checkIntervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
  ) {}

  start(): void {
    const alreadyCollected = this.capabilityRegistry.getCapabilities();
    if (!alreadyCollected) {
      throw new CapabilityLoopNotStartedError();
    }

    // Initial report — register() already collected it, but Laravel has
    // never seen it yet (lastSentReport starts null on this node process).
    void this.sendReport(alreadyCollected, ['*']);

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
    this.timer = setTimeout(() => void this.tick(), this.checkIntervalMs);
  }

  private async tick(): Promise<void> {
    try {
      const updated = await this.capabilityRegistry.update();
      const comparison = this.capabilityRegistry.compare(this.lastSentReport ?? updated, updated);

      if (comparison.changed) {
        await this.sendReport(updated, comparison.changedFields);
      }
    } catch (error) {
      this.logger.error('Capability check failed', { error: (error as Error).message });
    } finally {
      this.scheduleNext();
    }
  }

  private async sendReport(report: CapabilityReportContract, changedFields: string[]): Promise<void> {
    try {
      await this.laravelApiClient.sendCapabilityReport(report);
      this.lastSentReport = report;
      this.logger.info('Capability Report forwarded to Laravel', { changedFields });
    } catch (error) {
      // lastSentReport intentionally NOT updated on failure — the next
      // tick's compare() still sees this as an unsent change and retries.
      this.logger.error('Failed to send Capability Report', { error: (error as Error).message });
    }
  }
}
