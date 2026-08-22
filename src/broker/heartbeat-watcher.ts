import type { Logger } from '../types/log.types.js';

const DEFAULT_OFFLINE_THRESHOLD_MS = 30_000;

export interface IHeartbeatWatcher {
  recordHeartbeat(nodeUuid: string, atMs?: number): void;
  isOnline(nodeUuid: string, nowMs?: number): boolean;
  findNewlyOfflineNodes(nowMs?: number): string[];
  forget(nodeUuid: string): void;
}

/**
 * Tracks per-node liveness only (last-seen timestamp) — not what a node
 * can do (that's CachedNode.capability, owned by RenderBrokerService).
 * A node is OFFLINE once more than 30s (spec's own number) pass without a
 * heartbeat. findNewlyOfflineNodes() is meant to be polled periodically
 * (by RenderBrokerService.checkFailover() in this simulation, by a real
 * scheduled sweep in production) — it only reports a node once per
 * offline transition, never repeatedly, so a caller can safely trigger
 * Dead Job Recovery exactly once per outage.
 */
export class HeartbeatWatcher implements IHeartbeatWatcher {
  private readonly lastSeenAt = new Map<string, number>();
  private readonly reportedOffline = new Set<string>();

  constructor(
    private readonly logger: Logger,
    private readonly offlineThresholdMs: number = DEFAULT_OFFLINE_THRESHOLD_MS,
  ) {}

  recordHeartbeat(nodeUuid: string, atMs: number = Date.now()): void {
    this.lastSeenAt.set(nodeUuid, atMs);

    if (this.reportedOffline.delete(nodeUuid)) {
      this.logger.info('Node tekrar çevrimiçi', { nodeUuid });
    }
  }

  isOnline(nodeUuid: string, nowMs: number = Date.now()): boolean {
    const lastSeen = this.lastSeenAt.get(nodeUuid);
    if (lastSeen === undefined) {
      return false;
    }
    return nowMs - lastSeen <= this.offlineThresholdMs;
  }

  findNewlyOfflineNodes(nowMs: number = Date.now()): string[] {
    const newlyOffline: string[] = [];

    for (const [nodeUuid, lastSeen] of this.lastSeenAt.entries()) {
      const offline = nowMs - lastSeen > this.offlineThresholdMs;
      if (offline && !this.reportedOffline.has(nodeUuid)) {
        this.reportedOffline.add(nodeUuid);
        newlyOffline.push(nodeUuid);
        this.logger.warn('Node çevrimdışı', { nodeUuid, lastSeenAgoMs: nowMs - lastSeen });
      }
    }

    return newlyOffline;
  }

  forget(nodeUuid: string): void {
    this.lastSeenAt.delete(nodeUuid);
    this.reportedOffline.delete(nodeUuid);
  }
}
