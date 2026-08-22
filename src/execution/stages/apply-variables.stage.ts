import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageError } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';
import { RetryOperation } from '../../services/retry-policy.service.js';
import { ErrorCode } from '../../errors/error-code.js';

/**
 * Applies PreparedProject.variablesFilePath to the open project, via
 * AfterEffectsEngine.applyVariables() (the new JSX Runtime + apply-variables.jsx
 * added in Phase 5). Real actual variable application is out of scope this
 * phase (see apply-variables.jsx) — only the wiring is exercised for real.
 */
export class ApplyVariablesStage implements IExecutionStage {
  readonly name = 'ApplyVariablesStage';

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.APPLYING_VARIABLES);

    const variablesFilePath = context.preparedProject.variablesFilePath;
    if (!variablesFilePath) {
      throw new ExecutionStageError(
        this.name,
        ErrorCode.VARIABLE_FILE_PATH_MISSING,
        'PreparedProject.variablesFilePath boş.',
        { jobUuid: context.job.jobUuid },
      );
    }

    await context.retryPolicy.execute(RetryOperation.ADOBE_JSX, () =>
      context.afterEffectsEngine.applyVariables(variablesFilePath),
    );

    context.logger.info('Değişkenler uygulandı', {
      jobUuid: context.job.jobUuid,
      variablesFilePath,
    });

    return context;
  }
}
