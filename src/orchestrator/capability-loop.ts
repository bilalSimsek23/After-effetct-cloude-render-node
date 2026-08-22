import type { CapabilityRegistry } from '../capabilities/capability-registry.js';
import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { Logger } from '../types/log.types.js';

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class CapabilityLoopNotStartedError extends Error {
  constructor() {
    super(
      'CapabilityLoop.start(), CapabilityRegistry.register() çağrılmadan önce çalıştırılamaz — henüz toplanmış bir Capability Report yok.',
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
 * Laravel has no capability-report endpoint yet (routes/api.php only
 * defines heartbeat/claim/payload/project-asset/dependency-package) - a
 * detected change is only logged for now, not sent, until that endpoint
 * exists. This is a known, deliberate gap (not silently pretending to sync
 * with a server that can't receive it), tracked separately from this
 * Render Node ↔ Laravel integration pass.
 */
export class CapabilityLoop {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private lastSentReport: CapabilityReportContract | null = null;

  constructor(
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly logger: Logger,
    private readonly checkIntervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
  ) {}

  start(): void {
    const alreadyCollected = this.capabilityRegistry.getCapabilities();
    if (!alreadyCollected) {
      throw new CapabilityLoopNotStartedError();
    }
    this.lastSentReport = alreadyCollected;
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
        this.lastSentReport = updated;
        this.logger.info('Capability değişti (Laravel tarafında henüz bunu alacak bir uç nokta yok)', {
          changedFields: comparison.changedFields,
        });
      }
    } catch (error) {
      this.logger.error('Capability kontrolü başarısız oldu', { error: (error as Error).message });
    } finally {
      this.scheduleNext();
    }
  }
}
