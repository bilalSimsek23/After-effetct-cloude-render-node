import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';

/**
 * Ends the job's AdobeSession (real, safe, idempotent — see
 * AdobeSession.dispose()). Deleting the Job Workspace / temporary files is
 * intentionally NOT done here yet (see spec: "gerçek silme işlemi
 * yapılmayacaktır") — that lands once a real render has actually produced
 * something worth preserving/inspecting first.
 */
export class CleanupStage implements IExecutionStage {
  readonly name = 'CleanupStage';

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.CLEANING_UP);

    await context.adobeSession.dispose();

    context.logger.info('Cleanup tamamlandı (workspace/temp dosyaları henüz silinmiyor)', {
      jobUuid: context.job.jobUuid,
    });

    return context;
  }
}
