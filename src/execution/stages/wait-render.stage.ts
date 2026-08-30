import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageError } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';
import { ErrorCode } from '../../errors/error-code.js';

/**
 * Waits for the real render to finish — real, since Faz 8A: delegates to
 * IRenderEngine.waitForRenderCompletion(), which now checks the render
 * queue item's real status (DONE/ERR_STOPPED) directly, with
 * output-file growth as a fallback signal (see that method's own note).
 */
export class WaitRenderStage implements IExecutionStage {
  readonly name = 'WaitRenderStage';

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.WAITING_RENDER);

    const outputFilePath = context.state.outputFilePath;
    if (!outputFilePath) {
      throw new ExecutionStageError(
        this.name,
        ErrorCode.RENDER_OUTPUT_PATH_MISSING,
        'state.outputFilePath is empty — there is no render output path to wait for.',
        { jobUuid: context.job.jobUuid },
      );
    }
    const renderQueueItemIndex = context.state.renderQueueItemIndex;
    if (renderQueueItemIndex === null) {
      throw new ExecutionStageError(
        this.name,
        ErrorCode.RENDER_QUEUE_ITEM_INDEX_MISSING,
        'state.renderQueueItemIndex is empty — there is no render queue item to watch.',
        { jobUuid: context.job.jobUuid },
      );
    }

    context.logger.info('Waiting for render to complete', {
      jobUuid: context.job.jobUuid,
      queueItemId: context.state.renderQueueItemId,
      renderQueueItemIndex,
      outputFilePath,
    });

    await context.renderEngine.waitForRenderCompletion(outputFilePath, renderQueueItemIndex);

    return context;
  }
}
