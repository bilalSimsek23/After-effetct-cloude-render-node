import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withTimeout } from '../../utils/with-timeout.js';
import type { Logger } from '../../types/log.types.js';
import type { ICapabilityProvider } from '../capability-provider.interface.js';
import type { CapabilityHardwareInfo } from '../../contracts/capability-report.contract.js';

const execFileAsync = promisify(execFile);
const SHELL_TIMEOUT_MS = 5000;

interface GpuInfo {
  model: string;
  memoryBytes: number | null;
}

interface DiskInfo {
  freeBytes: number;
  totalBytes: number;
}

/**
 * CPU/RAM come from Node's own os module (always available). GPU/disk are
 * best-effort shell probes — macOS uses `system_profiler`/`df`, Windows uses
 * PowerShell CIM queries (there is no Windows equivalent binary for either,
 * and `wmic` is deprecated/removed on newer Windows releases) — both
 * wrapped in the shared timeout utility and fall back to null on any
 * failure, never throwing.
 */
export class HardwareCapabilityProvider implements ICapabilityProvider<CapabilityHardwareInfo> {
  readonly name = 'hardware';

  constructor(private readonly logger: Logger) {}

  async collect(): Promise<CapabilityHardwareInfo> {
    const cpus = os.cpus();
    const [gpu, disk] = await Promise.all([this.collectGpu(), this.collectDisk()]);

    return {
      cpuModel: cpus[0]?.model ?? 'unknown',
      cpuCores: cpus.length,
      ramTotalBytes: os.totalmem(),
      gpuModel: gpu?.model ?? null,
      gpuMemoryBytes: gpu?.memoryBytes ?? null,
      diskFreeBytes: disk?.freeBytes ?? null,
      diskTotalBytes: disk?.totalBytes ?? null,
    };
  }

  private async collectGpu(): Promise<GpuInfo | null> {
    return process.platform === 'win32' ? this.collectGpuWindows() : this.collectGpuMac();
  }

  private async collectGpuMac(): Promise<GpuInfo | null> {
    try {
      const { stdout } = await withTimeout(
        execFileAsync('system_profiler', ['SPDisplaysDataType', '-json']),
        SHELL_TIMEOUT_MS,
        'system_profiler',
      );
      const parsed = JSON.parse(stdout) as {
        SPDisplaysDataType?: Array<{ sppci_model?: string }>;
      };
      const model = parsed.SPDisplaysDataType?.[0]?.sppci_model;
      return model ? { model, memoryBytes: null } : null;
    } catch (error) {
      this.logger.debug('Could not read GPU info', { error: (error as Error).message });
      return null;
    }
  }

  private async collectGpuWindows(): Promise<GpuInfo | null> {
    try {
      const { stdout } = await withTimeout(
        execFileAsync('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name',
        ]),
        SHELL_TIMEOUT_MS,
        'gpu-powershell',
      );
      const model = stdout.trim();
      return model.length > 0 ? { model, memoryBytes: null } : null;
    } catch (error) {
      this.logger.debug('Could not read GPU info', { error: (error as Error).message });
      return null;
    }
  }

  private async collectDisk(): Promise<DiskInfo | null> {
    return process.platform === 'win32' ? this.collectDiskWindows() : this.collectDiskMac();
  }

  private async collectDiskMac(): Promise<DiskInfo | null> {
    try {
      const { stdout } = await withTimeout(
        execFileAsync('df', ['-k', os.homedir()]),
        SHELL_TIMEOUT_MS,
        'df',
      );
      const lines = stdout.trim().split('\n');
      const columns = lines[lines.length - 1]?.trim().split(/\s+/);
      const totalKb = Number.parseInt(columns?.[1] ?? '', 10);
      const freeKb = Number.parseInt(columns?.[3] ?? '', 10);

      if (Number.isNaN(totalKb) || Number.isNaN(freeKb)) {
        return null;
      }

      return { totalBytes: totalKb * 1024, freeBytes: freeKb * 1024 };
    } catch (error) {
      this.logger.debug('Could not read disk info', { error: (error as Error).message });
      return null;
    }
  }

  private async collectDiskWindows(): Promise<DiskInfo | null> {
    try {
      const driveLetter = (process.env['SystemDrive'] ?? 'C:').replace(':', '');
      const { stdout } = await withTimeout(
        execFileAsync('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${driveLetter}:'" | ` +
            'Select-Object -ExpandProperty FreeSpace,Size | ConvertTo-Json',
        ]),
        SHELL_TIMEOUT_MS,
        'disk-powershell',
      );
      const parsed = JSON.parse(stdout) as number[] | { FreeSpace?: number; Size?: number };
      const [freeBytes, totalBytes] = Array.isArray(parsed)
        ? parsed
        : [parsed.FreeSpace, parsed.Size];

      if (typeof freeBytes !== 'number' || typeof totalBytes !== 'number') {
        return null;
      }

      return { freeBytes, totalBytes };
    } catch (error) {
      this.logger.debug('Could not read disk info', { error: (error as Error).message });
      return null;
    }
  }
}
