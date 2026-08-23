import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { ExecutionContext } from './execution-context.js';
import type { IExecutionStage } from './execution-stage.interface.js';
import { ExecutionStageError } from './execution-stage.interface.js';
import type { LoadProjectStage } from './stages/load-project.stage.js';
import type { ApplyVariablesStage } from './stages/apply-variables.stage.js';
import type { SaveProjectStage } from './stages/save-project.stage.js';
import type { QueueRenderStage } from './stages/queue-render.stage.js';
import type { WaitRenderStage } from './stages/wait-render.stage.js';
import type { CollectOutputStage } from './stages/collect-output.stage.js';
import type { UploadOutputStage } from './stages/upload-output.stage.js';
import type { CleanupStage } from './stages/cleanup.stage.js';
import { ExecutionResultStatus } from './execution-result.js';
import type { ExecutionResult } from './execution-result.js';
import { ExecutionStageName } from '../services/progress.service.js';
import { ContractName } from '../contracts/registry/contract-name.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import { createRenderResultContract } from '../contracts/render-result.contract.js';
import { AssetType, createAssetContract } from '../contracts/asset.contract.js';
import { RenderJobRenderType } from '../contracts/render-job.contract.js';
import { RenderNodeError } from '../errors/render-node-error.js';
import { hashFileSha256 } from '../utils/hash-file.js';
import type { Logger } from '../types/log.types.js';

/**
 * The single orchestrator of the whole render execution flow — the exact,
 * fixed order the spec requires (typed constructor parameters rather than
 * a generic stage array, so the order can never be reshuffled by a
 * caller). No Stage calls another Stage; this class alone decides what
 * runs next. Never talks to the API directly — Progress goes through
 * ProgressService (injected into the Context, not here), and the terminal
 * RenderResultContract this method builds is only returned, never sent;
 * pushing it to Laravel is left to whoever calls run() (a future
 * JobManager integration, out of scope here — same precedent as Phase 3/4).
 */
export class ExecutionPipeline {
  constructor(
    private readonly loadProjectStage: LoadProjectStage,
    private readonly applyVariablesStage: ApplyVariablesStage,
    private readonly saveProjectStage: SaveProjectStage,
    private readonly queueRenderStage: QueueRenderStage,
    private readonly waitRenderStage: WaitRenderStage,
    private readonly collectOutputStage: CollectOutputStage,
    private readonly uploadOutputStage: UploadOutputStage,
    private readonly cleanupStage: CleanupStage,
    private readonly contractRegistry: ContractRegistry,
    private readonly logger: Logger,
  ) {}

  async run(initialContext: ExecutionContext): Promise<ExecutionResult> {
    const startedAt = Date.now();
    const stages: IExecutionStage[] = [
      this.loadProjectStage,
      this.applyVariablesStage,
      this.saveProjectStage,
      this.queueRenderStage,
      this.waitRenderStage,
      this.collectOutputStage,
      this.uploadOutputStage,
      this.cleanupStage,
    ];

    let context = initialContext;

    try {
      for (const stage of stages) {
        const stageStartedAt = Date.now();
        this.logger.debug(`Stage çalıştırılıyor: ${stage.name}`, { jobUuid: context.job.jobUuid });
        context = await stage.execute(context);
        this.logger.info(`Stage tamamlandı: ${stage.name}`, {
          jobUuid: context.job.jobUuid,
          stage: stage.name,
          durationMs: Date.now() - stageStartedAt,
          result: 'OK',
        });
      }

      const renderResult = await this.buildRenderResult(context, Date.now() - startedAt);
      await context.progressService.stage(context.job.jobUuid, ExecutionStageName.COMPLETED);

      this.logger.info('Execution Pipeline tamamlandı', {
        jobUuid: context.job.jobUuid,
        durationMs: Date.now() - startedAt,
      });

      return {
        status: ExecutionResultStatus.COMPLETED,
        jobUuid: context.job.jobUuid,
        durationMs: Date.now() - startedAt,
        renderResult,
        errors: [],
      };
    } catch (error) {
      // RenderNodeError'lar (Faz 8B) gerçek bir `code` taşır — Laravel ve
      // ileride gelecek izleme sistemleri, mesaj metnini değiştirmenin
      // sınıflandırmayı sessizce bozmasından etkilenmeden bu kodla
      // sınıflandırma yapabilsin diye mesajın başına ekleniyor.
      // RenderResultContract.errors hâlâ düz string[] — Contract şeması
      // değişmedi.
      const message =
        error instanceof RenderNodeError
          ? `[${error.code}] ${error.message}`
          : (error as Error).message;
      this.logger.error('Execution Pipeline başarısız', {
        jobUuid: initialContext.job.jobUuid,
        stage: error instanceof ExecutionStageError ? error.stageName : null,
        durationMs: Date.now() - startedAt,
        result: 'FAILED',
        error: message,
        errorCode: error instanceof RenderNodeError ? error.code : null,
      });

      await initialContext.progressService
        .stage(initialContext.job.jobUuid, ExecutionStageName.FAILED)
        .catch(() => {});

      return {
        status: ExecutionResultStatus.FAILED,
        jobUuid: initialContext.job.jobUuid,
        durationMs: Date.now() - startedAt,
        renderResult: null,
        errors: [message],
      };
    }
  }

  private async buildRenderResult(context: ExecutionContext, executionDurationMs: number) {
    const outputFilePath = context.state.outputFilePath;
    const files = [];

    if (outputFilePath && (await this.pathExists(outputFilePath))) {
      const hash = await hashFileSha256(outputFilePath);
      const size = (await stat(outputFilePath)).size;

      files.push(
        createAssetContract({
          uuid: randomUUID(),
          hash,
          size,
          type:
            context.job.renderType === RenderJobRenderType.MASTER
              ? AssetType.MASTER
              : AssetType.PREVIEW,
          downloadUrl: context.state.uploadedUrl ?? '',
          cacheKey: `${context.job.jobUuid}:${hash}`,
        }),
      );
    }

    const version = this.contractRegistry.getCurrentVersion(ContractName.RENDER_RESULT);
    // Faz 3A — real duration from CollectOutputStage's ffprobe pass, when
    // it succeeded; falls back to 0 (this contract field's original
    // hardcoded value) if metadata collection failed or never ran, rather
    // than a fabricated/guessed number.
    const durationSeconds = context.state.outputMetadata?.durationSeconds ?? 0;
    const renderResult = createRenderResultContract(
      {
        previewUrl:
          context.job.renderType === RenderJobRenderType.PREVIEW ? context.state.uploadedUrl : null,
        masterUrl:
          context.job.renderType === RenderJobRenderType.MASTER ? context.state.uploadedUrl : null,
        durationSeconds,
        files,
        logs: [],
        warnings:
          files.length === 0 ? ['Bu fazda gerçek render alınmadı, output dosyası yok.'] : [],
        // Render Telemetry & Reliability Foundation — executionDurationSeconds
        // was already computed by this method's caller (ExecutionResult.durationMs)
        // but never carried into the Contract sent to Laravel; outputMetadata
        // was already collected by CollectOutputStage and discarded here.
        // Both are now forwarded (undefined, not 0/null, when metadata
        // collection failed — an absent field, not a fabricated zero).
        executionDurationSeconds: executionDurationMs / 1000,
        ...(context.state.outputMetadata
          ? {
              outputMetadata: {
                width: context.state.outputMetadata.width,
                height: context.state.outputMetadata.height,
                frameRate: context.state.outputMetadata.frameRate,
                videoCodec: context.state.outputMetadata.videoCodec,
                hasAudio: context.state.outputMetadata.hasAudio,
              },
            }
          : {}),
      },
      version,
    );

    this.contractRegistry.validate(ContractName.RENDER_RESULT, renderResult);

    return renderResult;
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
