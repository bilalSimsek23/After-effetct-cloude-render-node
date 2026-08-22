import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';
import { RetryOperation } from '../../services/retry-policy.service.js';
import type { IUploadService } from '../../services/upload.service.js';

/**
 * Uploads the collected output via the existing IUploadService (added in
 * an earlier phase, still a stub — see upload.service.ts). Not part of
 * ExecutionContext: an upload destination is this Stage's own concern, not
 * something every Stage needs, so it's a normal constructor dependency.
 */
export class UploadOutputStage implements IExecutionStage {
  readonly name = 'UploadOutputStage';

  constructor(private readonly uploadService: IUploadService) {}

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.UPLOADING_OUTPUT);

    const outputFilePath = context.state.outputFilePath ?? '';

    const uploadedUrl = await context.retryPolicy.execute(RetryOperation.UPLOAD, () =>
      this.uploadService.upload(outputFilePath, context.job.jobUuid),
    );

    context.state.uploadedUrl = uploadedUrl;

    context.logger.info('Çıktı yükleme adımı tamamlandı', {
      jobUuid: context.job.jobUuid,
      uploadedUrl,
    });

    return context;
  }
}
