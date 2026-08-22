/**
 * Machine/runtime information collected on startup and reported to Laravel
 * via register() and heartbeat().
 */
export interface NodeInfo {
  hostname: string;
  platform: string;
  architecture: string;
  cpuModel: string;
  cpuCoreCount: number;
  memory: {
    totalBytes: number;
    freeBytes: number;
  };
  nodeVersion: string;
  applicationVersion: string;
  /** Process uptime in seconds at the time this snapshot was taken. */
  uptimeSeconds: number;
}

/**
 * Values NodeInfoService can't determine on its own — supplied by the
 * caller (JobManager's running count, config values) when asking for a
 * fresh heartbeat metrics snapshot.
 */
export interface HeartbeatMetricsInput {
  runningJobs: number;
  maxConcurrentJobs: number;
  agentVersion: string;
}
