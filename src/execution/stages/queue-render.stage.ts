import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExecutionContext } from '../execution-context.js';
import type { IExecutionStage } from '../execution-stage.interface.js';
import { ExecutionStageName } from '../../services/progress.service.js';
import { RetryOperation } from '../../services/retry-policy.service.js';
import { RenderJobRenderType } from '../../contracts/render-job.contract.js';
import {
  getAdobeOutputModuleTemplate,
  getWatermarkText,
  getResolutionFactor,
} from '../../adobe/models/render-profile.types.js';
import type { RenderProfileRegistry } from '../../adobe/models/render-profile.registry.js';
import type { ManifestContract } from '../../contracts/manifest.contract.js';

const MANIFEST_FILE_NAME = 'manifest.json';

/**
 * Submits the saved project to the render queue via
 * IRenderEngine.enqueue() — the one method the pipeline uses for
 * rendering, regardless of which concrete renderer is wired in (today:
 * AfterEffectsRenderEngine).
 *
 * Faz 8C — also reads the real manifest.json ProjectValidator already
 * copied into workspace.manifest (before this stage ever runs) for three
 * OPTIONAL, per-template metadata fields (see
 * scanner-manifest-metadata-contract.md): `renderComposition` (which comp
 * to target — real projects can have several), `requiresAlpha` (switches
 * to the `alpha` render profile instead of context.renderProfile's
 * preview/master) and `renderDurationSeconds` (clips the render to
 * [0, duration] instead of the composition's full work area). All three
 * are optional and default to today's exact prior behavior when absent —
 * older manifests without them render identically to before.
 */
export class QueueRenderStage implements IExecutionStage {
  readonly name = 'QueueRenderStage';

  constructor(private readonly renderProfileRegistry: RenderProfileRegistry) {}

  async execute(context: ExecutionContext): Promise<ExecutionContext> {
    await context.progressService.stage(context.job.jobUuid, ExecutionStageName.QUEUEING_RENDER);

    const projectFilePath = context.preparedProject.projectFilePath ?? '';
    const outputDirectory =
      context.job.renderType === RenderJobRenderType.MASTER
        ? context.workspace.master
        : context.workspace.preview;
    // Requested path — real testing (Faz 8A) found Output Module can
    // silently rewrite this extension to match its actual template, so
    // the real path used downstream comes back from enqueue() instead.
    const requestedOutputFilePath = resolve(outputDirectory, `${context.job.jobUuid}.mp4`);

    const { renderComposition, requiresAlpha, renderDurationSeconds } =
      await this.readManifestRenderMetadata(context);

    let effectiveProfile = context.renderProfile;
    if (requiresAlpha) {
      const alphaProfile = this.renderProfileRegistry.find('alpha');
      if (alphaProfile) {
        effectiveProfile = alphaProfile;
      } else {
        context.logger.warn(
          "manifest.metadata.requiresAlpha true ama 'alpha' render profili tanımlı değil, normal profil kullanılacak",
          { jobUuid: context.job.jobUuid },
        );
      }
    }

    const { queueItemId, actualOutputFilePath, renderQueueItemIndex } =
      await context.retryPolicy.execute(RetryOperation.RENDER_QUEUE, () =>
        context.renderEngine.enqueue(
          projectFilePath,
          requestedOutputFilePath,
          getAdobeOutputModuleTemplate(effectiveProfile),
          renderComposition,
          renderDurationSeconds,
          getWatermarkText(effectiveProfile),
          getResolutionFactor(effectiveProfile),
        ),
      );

    context.state.renderQueueItemId = queueItemId;
    context.state.outputFilePath = actualOutputFilePath;
    context.state.renderQueueItemIndex = renderQueueItemIndex;

    context.logger.info('Render kuyruğa eklendi', {
      jobUuid: context.job.jobUuid,
      queueItemId,
      outputFilePath: actualOutputFilePath,
      renderComposition,
      requiresAlpha,
      renderDurationSeconds,
    });

    return context;
  }

  private async readManifestRenderMetadata(context: ExecutionContext): Promise<{
    renderComposition: string | null;
    requiresAlpha: boolean;
    renderDurationSeconds: number | null;
  }> {
    const manifestFilePath = resolve(context.workspace.manifest, MANIFEST_FILE_NAME);

    try {
      const manifest = JSON.parse(await readFile(manifestFilePath, 'utf-8')) as ManifestContract;
      const metadata = manifest.metadata;

      return {
        renderComposition:
          metadata && typeof metadata.renderComposition === 'string'
            ? metadata.renderComposition
            : null,
        requiresAlpha:
          metadata && typeof metadata.requiresAlpha === 'boolean' ? metadata.requiresAlpha : false,
        renderDurationSeconds:
          metadata && typeof metadata.renderDurationSeconds === 'number'
            ? metadata.renderDurationSeconds
            : null,
      };
    } catch (error) {
      context.logger.warn(
        'manifest.json okunamadı (renderComposition/requiresAlpha/renderDurationSeconds varsayılanları kullanılacak)',
        { jobUuid: context.job.jobUuid, manifestFilePath, error: (error as Error).message },
      );
      return { renderComposition: null, requiresAlpha: false, renderDurationSeconds: null };
    }
  }
}
