import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import type { AppleScriptRunner } from './applescript-runner.js';
import type { ProcessManager } from './process-manager.js';
import type { Logger } from '../../types/log.types.js';
import type { AdobeAppId } from '../models/adobe-app-id.js';
import { ADOBE_APP_DESCRIPTORS } from '../models/adobe-app.model.js';
import { ErrorCode } from '../../errors/error-code.js';
import { RenderNodeError } from '../../errors/render-node-error.js';

const DEFAULT_COMMAND_TIMEOUT_MS = 15000;

/**
 * Real UAT (2026-08-07) found that an uncaught exception inside JSX code
 * run via AppleScript's `DoScript` renders as After Effects' own blocking
 * native "Unable to execute script..." alert - requiring a human to click
 * OK - instead of failing back to Node as a normal rejected Promise. A
 * prior attempt at fixing this wrapped call sites in
 * `try { code } finally { cleanup }`, but a `finally` clause never stops an
 * exception from propagating - it still crosses the DoScript boundary and
 * still triggers the native dialog. `app.beginSuppressDialogs()` doesn't
 * help either - it only suppresses script-driven `alert()`-style dialogs,
 * never DoScript's own uncaught-exception reporting.
 *
 * The actual fix has to happen at the single, lowest point in the bridge -
 * runJsxCode() - not layered redundantly at every call site: wrap whatever
 * code is passed in with a real `catch` (not just `finally`), so the
 * exception is caught *inside* ExtendScript and never crosses the DoScript
 * boundary, so AE never shows its native dialog.
 *
 * The caught error can't be relayed back via DoScript's own return value -
 * verified empirically against a real running After Effects instance that
 * `DoScript`'s AppleScript-level result is always "0" regardless of the
 * script's actual completion value (After Effects' DoScript implementation
 * doesn't surface a script's last-expression value the way some other
 * scriptable apps' DoScript-style verbs do). This is exactly why
 * applyVariables() (AfterEffectsEngine) already reads its real result from
 * a file instead of trusting runJsxCode()'s return value - the same
 * file-based convention is used here: the catch block writes the error
 * message to a fresh temp file, and this method reads (and always cleans
 * up) that file afterward.
 */
export class JsxExecutionError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.JSX_EXECUTION_FAILED, message, context);
  }
}

export interface IAdobeBridge {
  isAppInstalled(appId: AdobeAppId): Promise<boolean>;
  getAppVersion(appId: AdobeAppId): Promise<string | null>;
  isAppRunning(appId: AdobeAppId): Promise<boolean>;
  launchApp(appId: AdobeAppId): Promise<void>;
  quitApp(appId: AdobeAppId): Promise<void>;
  sendAppleScriptCommand(appId: AdobeAppId, command: string, timeoutMs?: number): Promise<string>;
  runJsxCode(appId: AdobeAppId, jsxCode: string, timeoutMs?: number): Promise<string>;
  runJsxScript(appId: AdobeAppId, scriptPath: string, timeoutMs?: number): Promise<string>;
}

/**
 * The single boundary between Render Node and the operating system's
 * Adobe integration surface (AppleScript, /Applications, `open`). Engines
 * never touch child_process, AppleScript syntax, or file paths themselves —
 * they call these semantically-named methods instead.
 *
 * runJsxCode/runJsxScript are how engines actually drive an app (After
 * Effects has almost no AppleScript dictionary of its own beyond launch/
 * quit — real automation goes through ExtendScript via AppleScript's
 * DoScript/DoScriptFile verbs).
 */
export class AdobeBridge implements IAdobeBridge {
  private readonly bundlePathCache = new Map<AdobeAppId, string>();

  constructor(
    private readonly appleScriptRunner: AppleScriptRunner,
    private readonly processManager: ProcessManager,
    private readonly logger: Logger,
  ) {}

  async isAppInstalled(appId: AdobeAppId): Promise<boolean> {
    const bundlePath = await this.resolveBundlePath(appId);
    return bundlePath !== null;
  }

  async getAppVersion(appId: AdobeAppId): Promise<string | null> {
    const bundlePath = await this.resolveBundlePath(appId);
    if (!bundlePath) {
      return null;
    }
    return this.processManager.readBundleVersion(bundlePath);
  }

  async isAppRunning(appId: AdobeAppId): Promise<boolean> {
    const displayName = await this.resolveDisplayName(appId);
    if (!displayName) {
      return false;
    }

    try {
      const { stdout } = await this.appleScriptRunner.run(
        `application "${displayName}" is running`,
      );
      return stdout === 'true';
    } catch (error) {
      this.logger.debug('isAppRunning kontrolü başarısız oldu', {
        appId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async launchApp(appId: AdobeAppId): Promise<void> {
    const bundlePath = await this.resolveBundlePath(appId);
    if (!bundlePath) {
      throw new Error(`${ADOBE_APP_DESCRIPTORS[appId].label} kurulu değil, başlatılamıyor.`);
    }
    await this.processManager.launchApp(bundlePath);
  }

  async quitApp(appId: AdobeAppId): Promise<void> {
    const displayName = await this.resolveDisplayName(appId);
    if (!displayName) {
      return;
    }
    await this.appleScriptRunner.run(`tell application "${displayName}" to quit`);
  }

  async sendAppleScriptCommand(
    appId: AdobeAppId,
    command: string,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const displayName = await this.requireDisplayName(appId);
    const { stdout } = await this.appleScriptRunner.run(
      `tell application "${displayName}" to ${command}`,
      timeoutMs,
    );
    return stdout;
  }

  async runJsxCode(
    appId: AdobeAppId,
    jsxCode: string,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const displayName = await this.requireDisplayName(appId);
    const errorFilePath = join(tmpdir(), `render-node-jsx-error-${randomUUID()}.txt`);

    try {
      const guarded = this.withJsxErrorBoundary(jsxCode, errorFilePath);
      const escaped = guarded.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const { stdout } = await this.appleScriptRunner.run(
        `tell application "${displayName}" to DoScript "${escaped}"`,
        timeoutMs,
      );

      const caughtMessage = await this.readErrorFile(errorFilePath);
      if (caughtMessage !== null) {
        throw new JsxExecutionError(caughtMessage, { appId });
      }

      return stdout;
    } finally {
      await rm(errorFilePath, { force: true }).catch(() => {});
    }
  }

  /**
   * See JsxExecutionError's docblock. Deliberately a bare top-level
   * try/catch, not a function-wrapped `(function(){ ... })()` - the code
   * this wraps relies on DoScript's own "value of the last executed
   * statement" convention for its normal (non-error) return value, which a
   * function body would not preserve (a function's statements don't
   * implicitly become its return value the way top-level completion values
   * do). Only the exception path is redirected to the error file - the
   * success path's return value is completely unaffected by this wrapper.
   */
  private withJsxErrorBoundary(jsxCode: string, errorFilePath: string): string {
    return (
      `try {\n${jsxCode}\n} catch (__bridgeError) {\n` +
      `  var __bridgeErrorFile = new File(${JSON.stringify(errorFilePath)});\n` +
      `  __bridgeErrorFile.open('w');\n` +
      `  __bridgeErrorFile.write(__bridgeError && __bridgeError.message ? __bridgeError.message : String(__bridgeError));\n` +
      `  __bridgeErrorFile.close();\n` +
      `}`
    );
  }

  private async readErrorFile(errorFilePath: string): Promise<string | null> {
    try {
      const content = await readFile(errorFilePath, 'utf-8');
      return content.trim();
    } catch {
      return null;
    }
  }

  async runJsxScript(
    appId: AdobeAppId,
    scriptPath: string,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<string> {
    const displayName = await this.requireDisplayName(appId);
    const { stdout } = await this.appleScriptRunner.run(
      `tell application "${displayName}" to DoScriptFile "${scriptPath}"`,
      timeoutMs,
    );
    return stdout;
  }

  private async requireDisplayName(appId: AdobeAppId): Promise<string> {
    const displayName = await this.resolveDisplayName(appId);
    if (!displayName) {
      throw new Error(`${ADOBE_APP_DESCRIPTORS[appId].label} kurulu değil.`);
    }
    return displayName;
  }

  private async resolveBundlePath(appId: AdobeAppId): Promise<string | null> {
    const cached = this.bundlePathCache.get(appId);
    if (cached) {
      return cached;
    }

    const descriptor = ADOBE_APP_DESCRIPTORS[appId];
    const found = await this.processManager.findInstalledApp(descriptor.folderNamePattern);

    if (!found) {
      return null;
    }

    this.bundlePathCache.set(appId, found.bundlePath);
    return found.bundlePath;
  }

  private async resolveDisplayName(appId: AdobeAppId): Promise<string | null> {
    const bundlePath = await this.resolveBundlePath(appId);
    if (!bundlePath) {
      return null;
    }

    // AppleScript's `tell application "..."` expects the bundle name
    // without the .app suffix.
    const bundleName = bundlePath.split('/').pop() ?? '';
    return bundleName.replace(/\.app$/i, '');
  }
}
