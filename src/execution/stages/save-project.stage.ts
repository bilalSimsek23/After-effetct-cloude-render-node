import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';
import { RetryOperation } from '../../services/retry-policy.service.js';

/**
 * A normal Save via AfterEffectsEngine's saveProject() — falls back to a
 * real Save As (to the project's own known path) when the open project has
 * no file path yet, which happens for real for any project After Effects
 * had to convert from an older version on open (see
 * AfterEffectsEngine.saveProject()'s own docblock).
 */
export class SaveProjectStage implements IExecutionStage {
  readonly name = 'SaveProjectStage';

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.SAVING_PROJECT);

    await context.retryPolicy.execute(RetryOperation.ADOBE_JSX, () =>
      context.afterEffectsEngine.saveProject(context.preparedProject.projectFilePath ?? undefined),
    );

    context.logger.info('Proje kaydedildi', { jobUuid: context.job.jobUuid });

    return context;
  }
}
