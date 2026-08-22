import os from 'node:os';
import type { NodeInfo, HeartbeatMetricsInput } from '../types/node-info.types.js';
import type { HeartbeatMetrics } from '../types/api.types.js';
import { readApplicationVersion } from '../utils/read-application-version.js';

/**
 * Collects information about the host machine and runtime.
 *
 * `collect()` gathers the full static snapshot (hostname, platform, CPU) —
 * used exactly once, for register(). `collectHeartbeatMetrics()` gathers
 * only the lightweight, dynamic values a heartbeat needs; static node info
 * is never resent after registration.
 */
export class NodeInfoService {
  collect(): NodeInfo {
    const cpus = os.cpus();
    const firstCpu = cpus[0];

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      architecture: os.arch(),
      cpuModel: firstCpu?.model ?? 'unknown',
      cpuCoreCount: cpus.length,
      memory: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
      },
      nodeVersion: process.version,
      applicationVersion: readApplicationVersion(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  collectHeartbeatMetrics(input: HeartbeatMetricsInput): HeartbeatMetrics {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;

    return {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: { totalBytes, usedBytes, freeBytes, usagePercent },
      runningJobs: input.runningJobs,
      maxConcurrentJobs: input.maxConcurrentJobs,
      applicationVersion: readApplicationVersion(),
      agentVersion: input.agentVersion,
    };
  }
}
