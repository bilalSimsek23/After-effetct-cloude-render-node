import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageError } from '../execution-stage.interface.js';
import { PreparedProjectStatus } from '../../preparation/prepared-project.types.js';
import { ExecutionStageName } from '../../services/progress.service.js';
import { RetryOperation } from '../../services/retry-policy.service.js';
import { ErrorCode } from '../../errors/error-code.js';

/**
 * Opens PreparedProject.projectFilePath via AfterEffectsEngine — the
 * existing, already-tested openProject() (Phase 2), not a new JSX file.
 * Also the pipeline's one guard: nothing downstream should ever run
 * against a PreparedProject that isn't READY.
 */
export class LoadProjectStage implements IExecutionStage {
  readonly name = 'LoadProjectStage';

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.LOADING_PROJECT);

    if (context.preparedProject.status !== PreparedProjectStatus.READY) {
      throw new ExecutionStageError(
        this.name,
        ErrorCode.PROJECT_NOT_READY,
        `PreparedProject is not READY (status=${context.preparedProject.status}), pipeline cannot start.`,
        { jobUuid: context.job.jobUuid, status: context.preparedProject.status },
      );
    }

    const projectFilePath = context.preparedProject.projectFilePath;
    if (!projectFilePath) {
      throw new ExecutionStageError(
        this.name,
        ErrorCode.PROJECT_FILE_PATH_MISSING,
        'PreparedProject.projectFilePath is empty.',
        { jobUuid: context.job.jobUuid },
      );
    }

    await context.retryPolicy.execute(RetryOperation.ADOBE_JSX, () =>
      context.afterEffectsEngine.openProject(projectFilePath),
    );

    context.logger.info('Project opened', {
      jobUuid: context.job.jobUuid,
      projectFilePath,
      event: 'render_project_opened',
    });

    return context;
  }
}
