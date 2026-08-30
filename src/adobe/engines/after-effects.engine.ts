import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { IAdobeBridge } from '../bridge/adobe-bridge.js';
import type { IJsxRuntimeService } from '../../jsx/jsx-runtime.service.js';
import { JsxScriptName } from '../../jsx/jsx-script-name.js';
import type { IVariableResolver } from '../../jsx/variable-resolver.js';
import { ProjectOpenError, VariableApplicationError } from '../../jsx/variable-application.types.js';
import type { VariableApplicationReport } from '../../jsx/variable-application.types.js';
import type { Logger } from '../../types/log.types.js';
import { AdobeAppId } from '../models/adobe-app-id.js';
import { sleep } from '../../utils/sleep.js';
import { withTimeout } from '../../utils/with-timeout.js';

const READY_POLL_INTERVAL_MS = 500;
const DEFAULT_READY_TIMEOUT_MS = 30000;

export interface IAfterEffectsEngine {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  isRunning(): Promise<boolean>;
  launch(): Promise<void>;
  waitUntilReady(timeoutMs?: number): Promise<void>;
  openProject(path: string): Promise<void>;
  closeProject(): Promise<void>;
  /**
   * `fallbackPath`: where to Save As if the open project has no file path
   * at all — a real, permanent (not transient) state for any project After
   * Effects had to convert from an older version on open (see
   * openProject()'s own docblock and save-project.jsx). Always pass the
   * project's own known path here (e.g. PreparedProject.projectFilePath) so
   * this stays a normal, idempotent save on every following call once the
   * first one establishes the file association.
   */
  saveProject(fallbackPath?: string): Promise<void>;
  saveProjectAs(path: string): Promise<void>;
  runScript(scriptPath: string): Promise<string>;
  /**
   * Added in Phase 5, made real in Phase 8A — applies variables.json to
   * the currently open project via the JSX Runtime. `dryRun` reports
   * which properties would be touched without changing anything.
   */
  applyVariables(variablesFilePath: string, dryRun?: boolean): Promise<string>;
}

/**
 * Platform-independent: every OS/AppleScript detail is delegated to
 * IAdobeBridge. This class only knows After Effects' own vocabulary
 * (project open/save/close, running a JSX script) — never how any of it
 * is actually executed.
 */
export class AfterEffectsEngine implements IAfterEffectsEngine {
  constructor(
    private readonly bridge: IAdobeBridge,
    private readonly jsxRuntime: IJsxRuntimeService,
    private readonly variableResolver: IVariableResolver,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    this.logger.debug('AfterEffectsEngine.initialize()');
  }

  async shutdown(): Promise<void> {
    this.logger.debug('AfterEffectsEngine.shutdown()');
    await this.bridge.quitApp(AdobeAppId.AFTER_EFFECTS);
  }

  async isInstalled(): Promise<boolean> {
    return this.bridge.isAppInstalled(AdobeAppId.AFTER_EFFECTS);
  }

  async getVersion(): Promise<string | null> {
    return this.bridge.getAppVersion(AdobeAppId.AFTER_EFFECTS);
  }

  async isRunning(): Promise<boolean> {
    return this.bridge.isAppRunning(AdobeAppId.AFTER_EFFECTS);
  }

  async launch(): Promise<void> {
    this.logger.info('Launching After Effects');
    await this.bridge.launchApp(AdobeAppId.AFTER_EFFECTS);
  }

  async waitUntilReady(timeoutMs: number = DEFAULT_READY_TIMEOUT_MS): Promise<void> {
    await withTimeout(this.pollUntilReady(), timeoutMs, 'AfterEffects.waitUntilReady');
    this.logger.info('After Effects ready');
  }

  async openProject(path: string): Promise<void> {
    // Real testing (Faz 8A) found this is a genuine production risk, not
    // just a test-script nuisance: nothing in the pipeline closes a
    // project on failure (CleanupStage only disposes the session — see
    // its own comment), so a job that fails after modifying but before
    // saving leaves AE with unsaved changes open. The next job's
    // openProject() would then hit After Effects' "save changes?" dialog
    // and hang indefinitely with no one there to answer it. Discarding
    // any previously open project first guarantees a clean slate for
    // every job regardless of how the last one ended.
    //
    // Real UAT found a second, worse dialog: a project authored by an
    // older/different AE version (e.g. "this project must be converted
    // from version 16.1.3") triggers a blocking native alert with no
    // scripted answer, and any *later* uncaught JS exception in this same
    // AE session (e.g. save-project.jsx's PROJECT_HAS_NO_FILE_PATH) also
    // renders as a blocking "Unable to execute script..." alert instead of
    // failing back to Node — both cases just hang until a human clicks OK.
    // suppressDialogs() answers the first automatically (AE proceeds with
    // the conversion) and turns the second back into a normal thrown
    // error DoScript can report to Node. The immediate app.project.file
    // check below then catches a conversion that silently failed to
    // actually load a project (see ProjectOpenError below) right here,
    // instead of only surfacing much later as save-project.jsx's cryptic
    // PROJECT_HAS_NO_FILE_PATH after an entire ApplyVariablesStage ran
    // against whatever half-loaded project was left behind.
    const openedFilePath = await this.bridge.runJsxCode(
      AdobeAppId.AFTER_EFFECTS,
      this.suppressDialogs(
        `if (app.project) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } ` +
          `app.open(File(${this.jsxString(path)})); ` +
          `(app.project && app.project.file) ? app.project.file.fsName : '';`,
      ),
    );

    if (!openedFilePath) {
      throw new ProjectOpenError(
        'app.project.file was empty after opening the project - the After Effects version-conversion dialog probably failed to actually load the project.',
        { projectFilePath: path },
      );
    }
  }

  async closeProject(): Promise<void> {
    await this.bridge.runJsxCode(
      AdobeAppId.AFTER_EFFECTS,
      this.suppressDialogs('if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);'),
    );
  }

  async saveProject(fallbackPath?: string): Promise<void> {
    await this.jsxRuntime.runJsx(AdobeAppId.AFTER_EFFECTS, JsxScriptName.SAVE_PROJECT, {
      fallbackPath: fallbackPath ?? null,
    });
  }

  async saveProjectAs(path: string): Promise<void> {
    await this.bridge.runJsxCode(
      AdobeAppId.AFTER_EFFECTS,
      this.suppressDialogs(`if (app.project) app.project.save(File(${this.jsxString(path)}));`),
    );
  }

  async runScript(scriptPath: string): Promise<string> {
    return this.bridge.runJsxScript(AdobeAppId.AFTER_EFFECTS, scriptPath);
  }

  async applyVariables(variablesFilePath: string, dryRun = false): Promise<string> {
    // variables/ and manifest/ are always sibling folders under the same
    // job workspace root (see AdobeWorkspaceService, untouched this
    // phase) — deriving manifestFilePath this way needs no new parameter
    // threaded through ApplyVariablesStage (protected, unchanged).
    const jobRoot = dirname(dirname(variablesFilePath));
    const manifestFilePath = resolve(jobRoot, 'manifest', 'manifest.json');
    const resolvedFilePath = resolve(jobRoot, 'variables', 'resolved-variables.json');
    const reportFilePath = resolve(jobRoot, 'variables', 'application-report.json');

    await this.variableResolver.resolve(variablesFilePath, manifestFilePath, resolvedFilePath);

    const result = await this.jsxRuntime.runJsx(
      AdobeAppId.AFTER_EFFECTS,
      JsxScriptName.APPLY_VARIABLES,
      {
        variablesFile: resolvedFilePath,
        reportFile: reportFilePath,
        dryRun,
      },
    );

    const report = await this.readApplicationReport(reportFilePath);

    this.logger.info('Variables applied', {
      updatedCount: report.updatedCount,
      skippedCount: report.skippedCount,
      failedCount: report.failedCount,
      durationMs: report.durationMs,
    });

    if (report.failedCount > 0) {
      throw new VariableApplicationError(report);
    }

    return result;
  }

  private async readApplicationReport(reportFilePath: string): Promise<VariableApplicationReport> {
    const raw = await readFile(reportFilePath, 'utf-8');
    return JSON.parse(raw) as VariableApplicationReport;
  }

  private async pollUntilReady(): Promise<void> {
    for (;;) {
      if (await this.isRunning()) {
        return;
      }
      await sleep(READY_POLL_INTERVAL_MS);
    }
  }

  /**
   * Wraps a snippet so any AE alert that would otherwise require a human
   * to click OK (version-conversion prompts, missing-font/effect
   * warnings, etc.) is auto-answered instead of blocking DoScript
   * indefinitely, and any uncaught exception inside `code` still surfaces
   * as a normal thrown error back through DoScript rather than as AE's
   * own blocking "Unable to execute script..." alert.
   */
  private suppressDialogs(code: string): string {
    return `app.beginSuppressDialogs(); try { ${code} } finally { app.endSuppressDialogs(false); }`;
  }

  private jsxString(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
}
