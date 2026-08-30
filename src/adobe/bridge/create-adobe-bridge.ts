import type { Logger } from '../../types/log.types.js';
import { AppleScriptRunner } from './applescript-runner.js';
import { ProcessManager, type IUrlOpener } from './process-manager.js';
import { AdobeBridge, type IAdobeBridge } from './adobe-bridge.js';
import { WindowsProcessManager } from './windows/windows-process-manager.js';
import { WindowsAdobeBridge } from './windows/windows-adobe-bridge.js';

export interface AdobeBridgeBundle {
  bridge: IAdobeBridge;
  /** Same underlying process manager the bridge uses - CloudFontActivatorService's only need from it. */
  urlOpener: IUrlOpener;
}

/**
 * The single `process.platform` branch point for the whole Adobe
 * automation layer (there was previously zero platform branching anywhere
 * in this codebase - AE automation was macOS-only). Every entrypoint
 * (main.ts and every *-check.ts diagnostic script) used to hand-construct
 * AppleScriptRunner + ProcessManager + AdobeBridge inline, identically, in
 * eight separate places; this factory replaces all eight so the platform
 * decision is made exactly once, here.
 */
export function createAdobeBridgeBundle(logger: Logger): AdobeBridgeBundle {
  if (process.platform === 'win32') {
    const processManager = new WindowsProcessManager(logger);
    return {
      bridge: new WindowsAdobeBridge(processManager, logger),
      urlOpener: processManager,
    };
  }

  const appleScriptRunner = new AppleScriptRunner(logger);
  const processManager = new ProcessManager(logger);
  return {
    bridge: new AdobeBridge(appleScriptRunner, processManager, logger),
    urlOpener: processManager,
  };
}

/**
 * For call sites that only need CloudFontActivatorService's dependency
 * (opening a URL) and never touch the Adobe bridge itself - avoids
 * constructing an unused AppleScriptRunner/AdobeBridge (or their Windows
 * counterparts) just to reach the process manager underneath.
 */
export function createUrlOpener(logger: Logger): IUrlOpener {
  return process.platform === 'win32'
    ? new WindowsProcessManager(logger)
    : new ProcessManager(logger);
}
