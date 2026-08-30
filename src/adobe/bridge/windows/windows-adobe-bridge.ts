import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import type { IAdobeBridge } from '../adobe-bridge.js';
import { JsxExecutionError } from '../adobe-bridge.js';
import { withJsxErrorBoundary, readJsxErrorFile } from '../jsx-error-boundary.js';
import { withTimeout, TimeoutError } from '../../../utils/with-timeout.js';
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
/**
 * A fresh Windows AE install/user profile ships with "Allow Scripts To
 * Write Files And Access Network" OFF by default (Edit > Preferences >
 * Scripting & Expressions). With it off, a script run via `-r` that
 * touches File/Folder (which is every script this bridge ever sends -
 * every JSX call is wrapped in withJsxErrorBoundary, which writes a File
 * on the error path alone) makes AE show its own blocking native alert -
 * "Unable to execute script. The Scripting plugin is not installed." -
 * misleading wording for what is actually this permission being off, not
 * a missing plugin (confirmed against a real Windows 11 + AE 2024 machine,
 * 2026-08-30). That dialog needs a human click, so any `-r` call made
 * while it's showing simply times out - which is what actually happens
 * the very first time this bridge runs against a never-before-scripted AE
 * profile.
 */
/**
 * A programmatic auto-fix was attempted here (calling
 * app.preferences.setPrefAsLong to flip the permission on before ever
 * running a real script) but had to be removed: confirmed against a real
 * Windows 11 + AE 2024 machine (2026-08-30) that
 * app.preferences.setPrefAsLong is undefined in this AE version, so the
 * call itself throws inside AE and pops AE's own blocking native dialog —
 * `-r` reports back as "done" before AE actually gets around to running
 * (and failing on) the script, so this looked like a harmless no-op from
 * Node's side while actually leaving AE stuck behind a dialog for the rest
 * of the process's life, breaking every subsequent call. There is no
 * scriptable way found so far to flip this permission from outside AE; the
 * only real fix is the manual one below.
 */
const SCRIPTING_PERMISSION_HINT =
  'After Effects\' "Allow Scripts to Write Files and Access Network" permission appears to be off. ' +
  'Open After Effects, go to Edit > Preferences > Scripting & Expressions, check ' +
  '"Allow Scripts to Write Files and Access Network", and try again.';

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

  /**
   * Matches by full executable path, not just process/image name: a real
   * test machine (2026-08-30) turned out to have BOTH "Adobe After Effects
   * 2023" and "...2024" installed side by side, and both ship an
   * identically-named AfterFX.exe. `tasklist`'s image-name filter can't
   * tell them apart, so if the user had 2023 open while this bridge always
   * resolves and targets 2024 (findInstalledApp() picks the newest
   * installed year), an image-name-only check would report "already
   * running" for the wrong version entirely - every `-r` call against the
   * actually-not-running 2024 install would then race against a genuine,
   * uncoordinated cold launch, matching the exact inconsistent timeouts
   * and dialogs seen in testing.
   */
  async isAppRunning(appId: AdobeAppId): Promise<boolean> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      return false;
    }

    try {
      const { stdout } = await withTimeout(
        execFileAsync('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='${this.imageNameFor(exePath)}'" | ` +
            'Select-Object -ExpandProperty ExecutablePath',
        ]),
        DEFAULT_COMMAND_TIMEOUT_MS,
        'tasklist',
      );
      const runningPaths = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return runningPaths.some((path) => path.toLowerCase() === exePath.toLowerCase());
    } catch (error) {
      this.logger.debug('isAppRunning check failed', {
        appId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async launchApp(appId: AdobeAppId): Promise<void> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      throw new Error(`${ADOBE_APP_DESCRIPTORS[appId].label} is not installed, cannot launch.`);
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
      this.logger.debug('quitApp execution error', {
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
      'sendAppleScriptCommand is specific to macOS/AppleScript and is not supported on Windows.',
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
    } catch (error) {
      throw this.explainIfTimeout(error);
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
    try {
      const { stdout } = await this.cliRunner.runFile(exePath, scriptPath, timeoutMs);
      return stdout;
    } catch (error) {
      throw this.explainIfTimeout(error);
    }
  }

  /**
   * Turns a bare TimeoutError (a `-r` process that never returned) into an
   * actionable message - see the scripting-permission docblock above for
   * why this specific timeout shape almost always means AE is sitting
   * behind its own blocking alert, not that the machine is merely slow.
   */
  private explainIfTimeout(error: unknown): Error {
    if (error instanceof TimeoutError) {
      return new Error(`${SCRIPTING_PERMISSION_HINT} (${error.message})`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private imageNameFor(exePath: string): string {
    return exePath.split('\\').pop() ?? 'AfterFX.exe';
  }

  private async requireExePath(appId: AdobeAppId): Promise<string> {
    const exePath = await this.resolveExePath(appId);
    if (!exePath) {
      throw new Error(`${ADOBE_APP_DESCRIPTORS[appId].label} is not installed.`);
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
