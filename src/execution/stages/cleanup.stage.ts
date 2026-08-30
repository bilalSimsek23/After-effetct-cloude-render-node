import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';

/**
 * Ends the job's AdobeSession (real, safe, idempotent — see
 * AdobeSession.dispose()). This stage itself still only disposes the
 * session object — it does NOT close the AE project (ExecutionPipeline.run()
 * now guarantees that itself, in its own finally, on every exit path
 * including ones where this stage never runs at all — see
 * closeProjectWithoutSaving()) and does NOT delete the job's workspace
 * directory (Community Render Asset Protection & Project Lifecycle
 * Security phase — JobProcessor.processJob() now deletes it in its own
 * outer finally, once the whole job — success or failure — is fully
 * resolved, which is a broader guarantee than this stage alone could ever
 * offer since it only ever runs on the success path).
 */
export class CleanupStage implements IExecutionStage {
  readonly name = 'CleanupStage';

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.CLEANING_UP);

    await context.adobeSession.dispose();

    context.logger.info('AdobeSession terminated (project close and workspace deletion are guaranteed separately)', {
      jobUuid: context.job.jobUuid,
    });

    return context;
  }
}
