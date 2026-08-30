import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import type { IAdobeBridge } from '../adobe-bridge.js';
import { JsxExecutionError } from '../adobe-bridge.js';
import { withJsxErrorBoundary, readJsxErrorFile } from '../jsx-error-boundary.js';
import { withTimeout } from '../../../utils/with-timeout.js';
import type { Logger } from '../../../types/log.types.js';
import type { AdobeAppId } from '../../models/adobe-app-id.js';
import { ADOBE_APP_DESCRIPTORS } from '../../models/adobe-app.model.js';
import type { WindowsProcessManager } from './windows-process-manager.js';
import { AfterFxCliRunner } from './afterfx-cli-runner.js';

const execFileAsync = promisify(execFile);
const DEFAULT_COMMAND_TIMEOUT_MS = 15000;

/**
 * Windows counterpart to AdobeBridge (macOS). Same IAdobeBridge contract,
 * same file-based JSX error boundary, same "one persistent AE instance,
 * many fast `-r` calls against it" shape - see WindowsProcessManager's
 * docblock for the empirical findings this design is built on (2026-08-30,
 * real Windows 11 + AE 2024 test machine, not guessed from documentation).
 *
 * There is no Windows equivalent of AppleScript's `application "..." is
 * running` or `tell application "..." to quit` verbs, so this class talks
 * to the OS process table directly (`tasklist`/`taskkill`-equivalent via
 * Node's own process APIs where possible) instead of routing everything
 * through AfterFxCliRunner the way macOS routes everything through
 * AppleScriptRunner.
 */
export class WindowsAdobeBridge implements IAdobeBridge {
  private readonly exePathCache = new Map<AdobeAppId, string>();
  private readonly cliRunner: AfterFxCliRunner;

  constructor(
    private readonly processManager: WindowsProcessManager,
    private readonly logger: Logger,
  ) {
    this.cliRunner = new AfterFxCliRunner(logger);
  }

  async isAppInstalled(appId: AdobeAppId): Promise<boolean> {
    const exePath = await this.resolveExePath(appId);
    return exePath !== null;
  }

  async getAppVersion(appId: AdobeAppId): Promise<string | null> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      return null;
    }
    return this.processManager.readBundleVersion(exePath);
  }

  async isAppRunning(appId: AdobeAppId): Promise<boolean> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      return false;
    }

    const imageName = this.imageNameFor(exePath);

    try {
      const { stdout } = await withTimeout(
        execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH']),
        DEFAULT_COMMAND_TIMEOUT_MS,
        'tasklist',
      );
      return stdout.toLowerCase().includes(imageName.toLowerCase());
    } catch (error) {
      this.logger.debug('isAppRunning kontrolü başarısız oldu', {
        appId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async launchApp(appId: AdobeAppId): Promise<void> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      throw new Error(`${ADOBE_APP_DESCRIPTORS[appId].label} kurulu değil, başlatılamıyor.`);
    }
    await this.processManager.launchApp(exePath);
  }

  /**
   * A real quit, not a kill - runs `app.quit()` through the exact same
   * `-r` transport as every other script here. Empirically confirmed
   * (2026-08-30) that `-r` against an already-running instance does NOT
   * quit AE afterward on its own, so an explicit quit script is the only
   * way to end a session cleanly; mirrors macOS quitApp()'s own behavior of
   * asking nicely rather than force-killing the process.
   */
  async quitApp(appId: AdobeAppId): Promise<void> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      return;
    }
    try {
      await this.cliRunner.runCode(exePath, 'app.quit();', DEFAULT_COMMAND_TIMEOUT_MS);
    } catch (error) {
      this.logger.debug('quitApp çalıştırma hatası', {
        appId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * AppleScript's generic "tell application to <verb>" has no Windows
   * counterpart, and nothing in this codebase actually calls this method
   * today (confirmed via a repo-wide search before writing this class) -
   * failing loudly here is safer than silently misinterpreting an arbitrary
   * verb string as JSX.
   */
  async sendAppleScriptCommand(): Promise<string> {
    throw new Error(
      'sendAppleScriptCommand macOS/AppleScript’e özgüdür, Windows’ta desteklenmiyor.',
    );
  }

  async runJsxCode(
    appId: AdobeAppId,
    jsxCode: string,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const exePath = await this.requireExePath(appId);
    const errorFilePath = join(tmpdir(), `render-node-jsx-error-${randomUUID()}.txt`);

    try {
      const guarded = withJsxErrorBoundary(jsxCode, errorFilePath);
      const { stdout } = await this.cliRunner.runCode(exePath, guarded, timeoutMs);

      const caughtMessage = await readJsxErrorFile(errorFilePath);
      if (caughtMessage !== null) {
        throw new JsxExecutionError(caughtMessage, { appId });
      }

      return stdout;
    } finally {
      await rm(errorFilePath, { force: true }).catch(() => {});
    }
  }

  async runJsxScript(
    appId: AdobeAppId,
    scriptPath: string,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const exePath = await this.requireExePath(appId);
    const { stdout } = await this.cliRunner.runFile(exePath, scriptPath, timeoutMs);
    return stdout;
  }

  private imageNameFor(exePath: string): string {
    return exePath.split('\\').pop() ?? 'AfterFX.exe';
  }

  private async requireExePath(appId: AdobeAppId): Promise<string> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      throw new Error(`${ADOBE_APP_DESCRIPTORS[appId].label} kurulu değil.`);
    }
    return exePath;
  }

  private async resolveExePath(appId: AdobeAppId): Promise<string | null> {
    const cached = this.exePathCache.get(appId);
    if (cached) {
      return cached;
    }

    const descriptor = ADOBE_APP_DESCRIPTORS[appId];
    const found = await this.processManager.findInstalledApp(descriptor.folderNamePattern);

    if (!found) {
      return null;
    }

    this.exePathCache.set(appId, found.bundlePath);
    return found.bundlePath;
  }
}
