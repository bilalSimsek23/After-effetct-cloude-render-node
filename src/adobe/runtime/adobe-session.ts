import type { IAfterEffectsEngine } from '../engines/after-effects.engine.js';
import type { IRenderEngine } from '../engines/after-effects-render.engine.js';
import type { JobWorkspacePaths } from './adobe-workspace.service.js';
import type { Logger } from '../../types/log.types.js';

/**
 * Represents a single Render Job's use of Adobe. Lives at job scope
 * (created per job_uuid), unlike AdobeRuntimeService which lives at node
 * scope — many sessions can exist under one Runtime.
 *
 * A session never launches or quits After Effects/Media Encoder itself:
 * those stay running for the whole node lifecycle, owned by
 * AdobeRuntimeService. A session only borrows access to the already-ready
 * engines, plus owns the job's isolated workspace, for the duration of
 * one job.
 *
 * No render logic lives here yet — this phase only prepares the access
 * point Scanner/Preview Render/Master Render will use.
 */
export class AdobeSession {
  private disposed = false;
  private readonly startedAt = new Date();

  constructor(
    public readonly jobUuid: string,
    private readonly afterEffectsEngine: IAfterEffectsEngine,
    private readonly renderEngine: IRenderEngine,
    private readonly workspace: JobWorkspacePaths,
    private readonly logger: Logger,
  ) {
    this.logger.info('AdobeSession started', { jobUuid: this.jobUuid });
  }

  getAfterEffectsEngine(): IAfterEffectsEngine {
    this.assertNotDisposed();
    return this.afterEffectsEngine;
  }

  getRenderEngine(): IRenderEngine {
    this.assertNotDisposed();
    return this.renderEngine;
  }

  getWorkspace(): JobWorkspacePaths {
    this.assertNotDisposed();
    return this.workspace;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const durationMs = Date.now() - this.startedAt.getTime();
    this.logger.info('AdobeSession disposed', { jobUuid: this.jobUuid, durationMs });
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error(`AdobeSession (${this.jobUuid}) is already disposed and cannot be used.`);
    }
  }
}
