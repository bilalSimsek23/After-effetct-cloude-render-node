import { stat } from 'node:fs/promises';
import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';
import { OutputValidationError } from '../../jsx/variable-application.types.js';
import { RenderNodeError } from '../../errors/render-node-error.js';
import { ErrorCode } from '../../errors/error-code.js';
import { hashFileSha256 } from '../../utils/hash-file.js';
import { collectOutputMetadata } from '../../utils/ffprobe-metadata.js';

const MIN_VALID_OUTPUT_BYTES = 1;

/**
 * Validates the real render output — since Faz 8A, WaitRenderStage only
 * returns once the file has genuinely stopped growing, so by this point
 * the file is expected to exist and be non-empty. A missing or 0-byte
 * file is treated as a real, corrupt-output failure, not silently
 * accepted.
 *
 * Faz 3A added: a distinct OUTPUT_NOT_FOUND code for the "file genuinely
 * doesn't exist" case (kept separate from OutputValidationError's
 * RENDER_OUTPUT_VALIDATION_FAILED, which now covers only "exists but
 * empty/corrupt"), plus real ffprobe metadata collection. A metadata
 * failure is logged (OUTPUT_METADATA_FAILED) but does not fail the stage —
 * the output file itself is already verified real and non-empty by that
 * point, so a render this stage reports as failed would never be one that
 * genuinely succeeded.
 */
export class CollectOutputStage implements IExecutionStage {
  readonly name = 'CollectOutputStage';

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.COLLECTING_OUTPUT);

    const outputFilePath = context.state.outputFilePath;
    if (!outputFilePath) {
      throw new OutputValidationError('state.outputFilePath is empty — there is no output to validate.', {
        jobUuid: context.job.jobUuid,
      });
    }

    const stats = await stat(outputFilePath).catch(() => null);
    if (!stats) {
      throw new RenderNodeError(
        ErrorCode.OUTPUT_NOT_FOUND,
        `Render output not found: ${outputFilePath}`,
        { jobUuid: context.job.jobUuid, outputFilePath },
      );
    }
    if (stats.size < MIN_VALID_OUTPUT_BYTES) {
      throw new OutputValidationError(`Render output is empty: ${outputFilePath} (size=${stats.size})`, {
        jobUuid: context.job.jobUuid,
        outputFilePath,
        size: stats.size,
      });
    }

    const hash = await hashFileSha256(outputFilePath);

    context.logger.info('Render output validated', {
      jobUuid: context.job.jobUuid,
      outputFilePath,
      size: stats.size,
      hash,
    });

    try {
      context.state.outputMetadata = await collectOutputMetadata(outputFilePath);
      context.logger.info('Render output metadata collected (ffprobe)', {
        jobUuid: context.job.jobUuid,
        outputFilePath,
        ...context.state.outputMetadata,
      });
    } catch (error) {
      context.logger.error('Render output metadata collection failed (render not treated as failed)', {
        jobUuid: context.job.jobUuid,
        outputFilePath,
        errorCode: ErrorCode.OUTPUT_METADATA_FAILED,
        error: (error as Error).message,
      });
    }

    return context;
  }
}
