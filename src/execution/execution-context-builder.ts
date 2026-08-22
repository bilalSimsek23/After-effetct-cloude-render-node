import type { RenderJobContract } from '../contracts/render-job.contract.js';
import type { PreparedProject } from '../preparation/prepared-project.types.js';
import type { RenderProfile } from '../adobe/models/render-profile.types.js';
import type { AdobeSession } from '../adobe/runtime/adobe-session.js';
import type { IProgressService } from '../services/progress.service.js';
import type { IRetryPolicyService } from '../services/retry-policy.service.js';
import type { Logger } from '../types/log.types.js';
import { createInitialExecutionState } from './execution-context.js';
import type { ExecutionContext } from './execution-context.js';

export interface ExecutionContextBuildInput {
  job: RenderJobContract;
  preparedProject: PreparedProject;
  adobeSession: AdobeSession;
  renderProfile: RenderProfile;
  progressService: IProgressService;
  retryPolicy: IRetryPolicyService;
  logger: Logger;
}

export interface IExecutionContextBuilder {
  build(input: ExecutionContextBuildInput): ExecutionContext;
}

/**
 * The one place an ExecutionContext is assembled. Workspace and both
 * engines are pulled from the given AdobeSession rather than accepted as
 * separate inputs — a session is already the single source of truth for a
 * job's workspace/engine access (see AdobeSession), so there is no second
 * copy that could drift out of sync with it.
 */
export class ExecutionContextBuilder implements IExecutionContextBuilder {
  build(input: ExecutionContextBuildInput): ExecutionContext {
    const context: ExecutionContext = {
      job: input.job,
      preparedProject: input.preparedProject,
      workspace: input.adobeSession.getWorkspace(),
      renderProfile: input.renderProfile,
      adobeSession: input.adobeSession,
      afterEffectsEngine: input.adobeSession.getAfterEffectsEngine(),
      renderEngine: input.adobeSession.getRenderEngine(),
      progressService: input.progressService,
      retryPolicy: input.retryPolicy,
      logger: input.logger,
      state: createInitialExecutionState(),
    };

    return Object.freeze(context);
  }
}
