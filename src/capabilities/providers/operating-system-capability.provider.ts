import os from 'node:os';
import type { ICapabilityProvider } from '../capability-provider.interface.js';

export interface OperatingSystemInfo {
  hostname: string;
  operatingSystem: string;
  architecture: string;
}

export class OperatingSystemCapabilityProvider implements ICapabilityProvider<OperatingSystemInfo> {
  readonly name = 'operating-system';

  async collect(): Promise<OperatingSystemInfo> {
    return {
      hostname: os.hostname(),
      operatingSystem: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
    };
  }
}
