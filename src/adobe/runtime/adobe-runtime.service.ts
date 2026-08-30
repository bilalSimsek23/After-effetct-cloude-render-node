import type { IAfterEffectsEngine } from '../engines/after-effects.engine.js';
import type { IRenderEngine } from '../engines/after-effects-render.engine.js';
import type { AdobeEnvironmentService } from './adobe-environment.service.js';
import type { AdobeWorkspaceService } from './adobe-workspace.service.js';
import { AdobeSession } from './adobe-session.js';
import type { IApiClient } from '../../api/api-client.interface.js';
import type { Logger } from '../../types/log.types.js';
import type { EnvironmentCheckResult } from '../models/environment-check.types.js';
import { SystemReadyStatus } from '../models/environment-check.types.js';

/**
 * Owns After Effects for the lifetime of the Render Node — nothing more.
 * Its job is: run the Environment Check, get After Effects ready, report
 * the node's READY/NOT_READY status, and keep it alive until the node
 * shuts down.
 *
 * Media Encoder is deliberately NOT launched, waited on, or shut down
 * here (Faz 8B) — rendering goes entirely through After Effects' own
 * render queue now (see AfterEffectsRenderEngine's own note, and
 * docs/adobe-platform-constraints.md), so there is no real reason to run
 * Media Encoder at all. `renderEngine` is still passed through to
 * AdobeSession, since job execution's render/wait calls go through it —
 * only the "manage this as a long-running application" concern was
 * removed.
 *
 * It does NOT contain render job logic and initialize() is never called
 * again once the node is up — per-job work goes through createSession(),
 * which hands out an AdobeSession (job-scoped) rather than exposing the
 * engines directly. JobManager (and, later, Scanner/Renderer/Upload) must
 * go through a session, never straight to AfterEffectsEngine/
 * AfterEffectsRenderEngine.
 *
 * Only quits After Effects on shutdown() if this service is the one that
 * launched it: an app that was already open before initialize() ran
 * (e.g. an artist's own session) is left alone, never force-quit by an
 * automated check.
 */
export class AdobeRuntimeService {
  private ready = false;
  private launchedAfterEffects = false;
  private readonly activeSessions = new Map<string, AdobeSession>();

  constructor(
    private readonly afterEffectsEngine: IAfterEffectsEngine,
    private readonly renderEngine: IRenderEngine,
    private readonly environmentService: AdobeEnvironmentService,
    private readonly workspaceService: AdobeWorkspaceService,
    private readonly apiClient: IApiClient,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<EnvironmentCheckResult> {
    const checkResult = await this.environmentService.check();

    // Best-effort: Laravel has no confirmed system-status endpoint yet
    // (same category of gap as CapabilityLoop's capability reporting) - a
    // real, working Environment Check must not be blocked by a reporting
    // call to an endpoint that may not exist.
    try {
      await this.apiClient.reportSystemStatus({
        status: checkResult.status,
        errors: checkResult.errors,
      });
    } catch (error) {
      this.logger.warn('Failed to report system status to Laravel (endpoint may not exist yet)', {
        error: (error as Error).message,
      });
    }

    if (checkResult.status !== SystemReadyStatus.READY) {
      this.logger.error('Adobe Runtime failed to start: Environment Check failed', {
        errors: checkResult.errors,
      });
      return checkResult;
    }

    await this.afterEffectsEngine.initialize();

    this.launchedAfterEffects = !(await this.afterEffectsEngine.isRunning());
    if (this.launchedAfterEffects) {
      await this.afterEffectsEngine.launch();
    } else {
      this.logger.info('After Effects is already running, not relaunched');
    }

    await this.afterEffectsEngine.waitUntilReady();

    this.ready = true;
    this.logger.info('Adobe Runtime ready');

    return checkResult;
  }

  async shutdown(): Promise<void> {
    for (const jobUuid of [...this.activeSessions.keys()]) {
      await this.closeSession(jobUuid);
    }

    if (this.launchedAfterEffects) {
      await this.afterEffectsEngine.shutdown();
    } else {
      this.logger.debug('After Effects was not launched by this runtime, not shutting it down');
    }

    this.ready = false;
    this.launchedAfterEffects = false;
    this.logger.info('Adobe Runtime shut down');
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Opens a job-scoped AdobeSession borrowing access to the already-ready
   * engines, plus that job's isolated workspace. Many sessions may exist
   * concurrently under one runtime — this phase never runs them
   * concurrently, but nothing here assumes there's only ever one.
   */
  async createSession(jobUuid: string): Promise<AdobeSession> {
    if (!this.ready) {
      throw new Error('Adobe Runtime is not ready yet, cannot create AdobeSession.');
    }

    if (this.activeSessions.has(jobUuid)) {
      throw new Error(`An AdobeSession already exists for this job_uuid: ${jobUuid}`);
    }

    await this.ensureAfterEffectsReady();

    const jobWorkspace = await this.workspaceService.createJobWorkspace(jobUuid);
    const session = new AdobeSession(
      jobUuid,
      this.afterEffectsEngine,
      this.renderEngine,
      jobWorkspace,
      this.logger,
    );

    this.activeSessions.set(jobUuid, session);
    return session;
  }

  /**
   * initialize()'s own launch()+waitUntilReady() sequence only ever ran
   * once, at node startup - real testing found AE can end up closed by the
   * time an actual job arrives (a crash, a manual quit, an earlier job's
   * cleanup) with nothing here ever noticing before diving straight into
   * openProject() with a flat, un-retried timeout. Re-checking here, once
   * per job, closes that gap the same way waitUntilReady()'s own probe
   * already closes it for the very first cold launch: if AE is genuinely
   * still the warm instance from before, isRunning() is true and
   * waitUntilReady() (which does a real, side-effect-free script call, not
   * just a process-exists check) resolves almost immediately, adding
   * negligible per-job overhead.
   */
  private async ensureAfterEffectsReady(): Promise<void> {
    if (!(await this.afterEffectsEngine.isRunning())) {
      this.logger.warn('After Effects is not running at job start - relaunching');
      this.launchedAfterEffects = true;
      await this.afterEffectsEngine.launch();
    }

    await this.afterEffectsEngine.waitUntilReady();
  }

  async closeSession(jobUuid: string): Promise<void> {
    const session = this.activeSessions.get(jobUuid);
    if (!session) {
      return;
    }

    await session.dispose();
    this.activeSessions.delete(jobUuid);
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}
