import type { RenderJobContract } from '../contracts/render-job.contract.js';
import type { PreparedProject } from '../preparation/prepared-project.types.js';
import type { JobWorkspacePaths } from '../adobe/runtime/adobe-workspace.service.js';
import type { RenderProfile } from '../adobe/models/render-profile.types.js';
import type { AdobeSession } from '../adobe/runtime/adobe-session.js';
import type { IAfterEffectsEngine } from '../adobe/engines/after-effects.engine.js';
import type { IRenderEngine } from '../adobe/engines/after-effects-render.engine.js';
import type { IProgressService } from '../services/progress.service.js';
import type { IRetryPolicyService } from '../services/retry-policy.service.js';
import type { OutputMetadata } from '../utils/ffprobe-metadata.js';
import type { Logger } from '../types/log.types.js';

/**
 * The one mutable slot in an otherwise-frozen ExecutionContext: results
 * one Stage produces for a later Stage to read. No Stage ever reads
 * another Stage directly — this is the only channel between them.
 */
export interface ExecutionState {
  renderQueueItemId: string | null;
  outputFilePath: string | null;
  uploadedUrl: string | null;
  /**
   * Added in Faz 8A — the real AE render queue item's 1-based index,
   * needed so WaitRenderStage can query its real status (Queued/
   * Rendering/Done/Failed) instead of only inferring completion from
   * output-file growth, which can't distinguish "still rendering" from
   * "failed and will never produce a file" (real testing hit exactly
   * this: a corrupt source image failed the render immediately, but
   * file-only polling still waited the full timeout).
   */
  renderQueueItemIndex: number | null;
  /**
   * Added Faz 3A — real ffprobe output metadata, collected by
   * CollectOutputStage. Null when ffprobe itself failed (logged as
   * OUTPUT_METADATA_FAILED, non-fatal - the render output was already
   * verified to exist by that point) rather than when it simply hasn't run
   * yet, since this field is only ever read after CollectOutputStage.
   */
  outputMetadata: OutputMetadata | null;
}

export function createInitialExecutionState(): ExecutionState {
  return {
    renderQueueItemId: null,
    outputFilePath: null,
    uploadedUrl: null,
    renderQueueItemIndex: null,
    outputMetadata: null,
  };
}

/**
 * Everything a Stage needs, in one object, built once by
 * ExecutionContextBuilder and never replaced afterwards (frozen — see the
 * builder). Stages depend only on this shape, never on each other or on
 * concrete services beyond what's listed here.
 */
export interface ExecutionContext {
  readonly job: RenderJobContract;
  readonly preparedProject: PreparedProject;
  readonly workspace: JobWorkspacePaths;
  readonly renderProfile: RenderProfile;
  readonly adobeSession: AdobeSession;
  readonly afterEffectsEngine: IAfterEffectsEngine;
  readonly renderEngine: IRenderEngine;
  readonly progressService: IProgressService;
  readonly retryPolicy: IRetryPolicyService;
  readonly logger: Logger;
  readonly state: ExecutionState;
}
