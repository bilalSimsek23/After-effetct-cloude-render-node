import { randomUUID } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { IAdobeBridge } from '../bridge/adobe-bridge.js';
import type { IJsxRuntimeService } from '../../jsx/jsx-runtime.service.js';
import { JsxScriptName } from '../../jsx/jsx-script-name.js';
import {
  RenderQueueError,
  RenderTimeoutError,
  RenderFailedError,
  RenderConfigurationError,
} from '../../jsx/variable-application.types.js';
import type { Logger } from '../../types/log.types.js';
import { AdobeAppId } from '../models/adobe-app-id.js';
import { sleep } from '../../utils/sleep.js';
import { withTimeout } from '../../utils/with-timeout.js';

const READY_POLL_INTERVAL_MS = 500;
const DEFAULT_READY_TIMEOUT_MS = 30000;
const DEFAULT_RENDER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const RENDER_POLL_INTERVAL_MS = 2000;
/** Consecutive stable-size polls (never 0 bytes) before a render is considered finished — a single stable read could just be a slow write pausing momentarily. */
const STABILITY_REQUIRED_TICKS = 3;

/** Real RQItemStatus enum values (After Effects ExtendScript) — mirrored here since waitForRenderCompletion() reads them back from a real JSX status check, not a mock. */
const RQ_ITEM_STATUS_DONE = 3019;
const RQ_ITEM_STATUS_ERR_STOPPED = 3018;

/**
 * A static, Node-side fact (not probed from AE) about which IRenderEngine
 * implementation is wired in — Faz 8B, reported alongside the real,
 * probed capabilities in AdobeRuntimeCapabilities so a future scheduler
 * could tell nodes running different render engines apart.
 */
export const RENDER_ENGINE_MODE = 'after-effects-render-queue';

/**
 * `actualOutputFilePath` is the real path AE ended up writing to. Real
 * testing found Output Module.file's requested path can be silently
 * rewritten (extension changed to match the applied — or ambient, if
 * none applied — template's real container format), so the
 * originally-requested `outputFilePath` can't be trusted as the render's
 * true destination; only the value read back from AE after queuing can.
 * `renderQueueItemIndex` lets waitForRenderCompletion() query the real
 * render queue item's status directly.
 */
export interface EnqueueResult {
  queueItemId: string;
  actualOutputFilePath: string;
  renderQueueItemIndex: number;
}

/**
 * Renamed from IMediaEncoderEngine in Faz 8B — the pipeline depends on
 * this interface, never on a concrete renderer. Today's only
 * implementation renders via After Effects' own render queue (see
 * AfterEffectsRenderEngine's own note on why Media Encoder was
 * abandoned as the render path); a future renderer (real Media Encoder
 * hand-off if Adobe ever exposes real scriptable preset control, a cloud
 * renderer, etc.) would implement this same interface without the
 * pipeline changing at all.
 */
export interface IRenderEngine {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  isRunning(): Promise<boolean>;
  launch(): Promise<void>;
  waitUntilReady(timeoutMs?: number): Promise<void>;
  /**
   * The only render-queue surface the pipeline uses. `compositionName` is
   * optional (Faz 8C) — omitted, the queued render targets whatever
   * composition the JSX side's existing "first CompItem found" fallback
   * picks (unchanged default, safe for today's single-comp production
   * pipeline); real, multi-composition projects should pass the manifest's
   * `metadata.renderComposition` (see scanner-manifest-metadata-contract.md)
   * so the correct composition is targeted explicitly instead of guessed.
   * `renderDurationSeconds` is also optional — omitted, the render queue
   * item keeps AE's own default time span (typically the composition's
   * work area); provided, the render is clipped to [0, renderDurationSeconds]
   * (see manifest.metadata.renderDurationSeconds).
   * `watermarkText` (from the render profile's `watermarkEnabled` +
   * `watermarkText` renderer setting) adds a real text layer to the queued
   * composition, in-memory only, right before queuing - never saved to
   * disk (see queue-media-encoder.jsx). `resolutionFactor` is a
   * best-effort Render Settings override (e.g. "Half") for a genuinely
   * faster proxy render; failures are swallowed, never block the render.
   */
  enqueue(
    projectFilePath: string,
    outputFilePath: string,
    rendererPreset: string | null,
    compositionName?: string | null,
    renderDurationSeconds?: number | null,
    watermarkText?: string | null,
    resolutionFactor?: string | null,
  ): Promise<EnqueueResult>;
  /**
   * Blocks until the render queue item reports DONE, or the output file
   * genuinely stops growing (fallback, in case the status check itself
   * is ever unavailable). Throws RenderFailedError if the item reports
   * ERR_STOPPED, RenderTimeoutError if neither signal arrives in time.
   */
  waitForRenderCompletion(
    outputFilePath: string,
    renderQueueItemIndex: number,
    timeoutMs?: number,
  ): Promise<void>;
}

/**
 * Renamed from MediaEncoderEngine in Faz 8B. Two genuinely separate
 * concerns live here, deliberately kept in one class for now (splitting
 * them wasn't part of the approved rename scope):
 *
 * 1. Media Encoder *application* lifecycle (isInstalled/launch/shutdown/
 *    isRunning) — still real and still needed: Environment Check and the
 *    Capability Registry report whether Media Encoder is installed
 *    (dynamicLinkAvailable etc.) independently of how rendering actually
 *    happens.
 * 2. Render queue operations (enqueue/waitForRenderCompletion) — real,
 *    since Faz 8A, via AFTER EFFECTS' own render queue
 *    (`RenderQueue.renderAsync()`), never Media Encoder. Real testing in
 *    Faz 8A found `queueInAME()` silently ignores the Output Module
 *    settings this class configures — Media Encoder renders with
 *    whatever preset a human last selected in its own UI instead, with
 *    no scriptable way to control that (see
 *    docs/adobe-platform-constraints.md, "Media Encoder preset
 *    selection is not scriptable").
 */
export class AfterEffectsRenderEngine implements IRenderEngine {
  constructor(
    private readonly bridge: IAdobeBridge,
    private readonly jsxRuntime: IJsxRuntimeService,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    this.logger.debug('AfterEffectsRenderEngine.initialize()');
  }

  async shutdown(): Promise<void> {
    this.logger.debug('AfterEffectsRenderEngine.shutdown()');
    await this.bridge.quitApp(AdobeAppId.MEDIA_ENCODER);
  }

  async isInstalled(): Promise<boolean> {
    return this.bridge.isAppInstalled(AdobeAppId.MEDIA_ENCODER);
  }

  async getVersion(): Promise<string | null> {
    return this.bridge.getAppVersion(AdobeAppId.MEDIA_ENCODER);
  }

  async isRunning(): Promise<boolean> {
    return this.bridge.isAppRunning(AdobeAppId.MEDIA_ENCODER);
  }

  async launch(): Promise<void> {
    this.logger.info('Media Encoder başlatılıyor');
    await this.bridge.launchApp(AdobeAppId.MEDIA_ENCODER);
  }

  async waitUntilReady(timeoutMs: number = DEFAULT_READY_TIMEOUT_MS): Promise<void> {
    await withTimeout(this.pollUntilReady(), timeoutMs, 'MediaEncoder.waitUntilReady');
    this.logger.info('Media Encoder hazır');
  }

  async enqueue(
    projectFilePath: string,
    outputFilePath: string,
    rendererPreset: string | null,
    compositionName: string | null = null,
    renderDurationSeconds: number | null = null,
    watermarkText: string | null = null,
    resolutionFactor: string | null = null,
  ): Promise<EnqueueResult> {
    const queueItemId = randomUUID();
    // Sibling of the preview/master output folder, same sibling-folder
    // derivation AfterEffectsEngine.applyVariables() already uses for
    // manifest/variables — avoids threading a new parameter through
    // QueueRenderStage (protected, unchanged).
    const jobRoot = dirname(dirname(outputFilePath));
    const reportFilePath = resolve(jobRoot, 'temp', 'queue-media-encoder-report.txt');

    try {
      await this.jsxRuntime.runJsx(AdobeAppId.AFTER_EFFECTS, JsxScriptName.QUEUE_MEDIA_ENCODER, {
        projectFilePath,
        outputFilePath,
        mediaEncoderPreset: rendererPreset,
        reportFile: reportFilePath,
        compositionName,
        renderDurationSeconds,
        watermarkText,
        resolutionFactor,
      });
    } catch (error) {
      const rawMessage = (error as Error).message;
      const context = {
        projectFilePath,
        outputFilePath,
        rendererPreset,
        compositionName,
        renderDurationSeconds,
      };

      // Faz 3A — queue-media-encoder.jsx throws this exact marker when a
      // named renderComposition doesn't exist in the project, specifically
      // so the render never silently falls back to whatever comp AE would
      // otherwise pick. Classified separately from a genuine queueing
      // failure (RenderQueueError) so it's reported as
      // RENDER_CONFIGURATION_INVALID, not RENDER_QUEUE_FAILED.
      if (rawMessage.indexOf('RENDER_COMPOSITION_NOT_FOUND:') !== -1) {
        throw new RenderConfigurationError(
          `Belirtilen renderComposition projede bulunamadı - render başka bir composition'a sessizce düşürülmedi, durduruldu: ${rawMessage}`,
          context,
        );
      }

      throw new RenderQueueError(`Render Queue'ya gönderme başarısız: ${rawMessage}`, context);
    }

    const reportParts = (await readFile(reportFilePath, 'utf-8')).split('|');
    const actualOutputFilePath = (reportParts[0] ?? '').trim();
    const templateStatus = (reportParts[1] ?? '').trim();
    const renderQueueItemIndex = Number((reportParts[2] ?? '').trim());

    if (rendererPreset && templateStatus !== 'OK') {
      // Real testing (Faz 8A) found this exact failure mode: a mismatched
      // template name throws inside queue-media-encoder.jsx, and if that
      // were swallowed silently the queue falls back to whatever
      // ambient/last-used Output Module template this machine happens to
      // have — once, an Animated GIF one, discovered only by inspecting
      // Media Encoder's own queue panel. So this is always surfaced.
      this.logger.warn('Render preset uygulanamadı, ortamın varsayılan şablonu kullanıldı', {
        rendererPreset,
        templateStatus,
        actualOutputFilePath,
      });
    }

    this.logger.info("Render Queue'ya gönderildi", {
      queueItemId,
      requestedOutputFilePath: outputFilePath,
      actualOutputFilePath,
      renderQueueItemIndex,
    });

    return { queueItemId, actualOutputFilePath, renderQueueItemIndex };
  }

  async waitForRenderCompletion(
    outputFilePath: string,
    renderQueueItemIndex: number,
    timeoutMs: number = DEFAULT_RENDER_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let stableTicks = 0;

    while (Date.now() < deadline) {
      const status = await this.getRenderQueueItemStatus(outputFilePath, renderQueueItemIndex);

      if (status === RQ_ITEM_STATUS_ERR_STOPPED) {
        throw new RenderFailedError(
          `Render hatayla durdu (render queue item #${renderQueueItemIndex}): ${outputFilePath}`,
          { outputFilePath, renderQueueItemIndex },
        );
      }

      if (status === RQ_ITEM_STATUS_DONE) {
        this.logger.info('Render tamamlandı (render queue item DONE)', {
          outputFilePath,
          renderQueueItemIndex,
        });
        return;
      }

      if (status !== null) {
        // The real render queue item status is available and says the
        // render is still genuinely in progress (RENDERING/QUEUED/...) -
        // this is authoritative and must win outright. The file-size
        // "stability" fallback below is not a second, independent vote -
        // real testing found a 212 MB finished .mov spend its first ~6
        // seconds sitting at a constant 1 MiB on disk (the encoder/OS
        // buffers before flushing real frame data), which the fallback
        // read as "stopped growing = done" and reported a genuinely
        // still-rendering job as finished with a ~1/200th-sized garbage
        // preview - while the real render queue status correctly still
        // said "rendering" the entire time. Only fall through to the
        // file-size heuristic when the authoritative check is actually
        // unavailable (status === null, e.g. the JSX call itself failed) -
        // that's the only scenario this fallback was ever meant to cover.
        stableTicks = 0;
        lastSize = -1;
        await sleep(RENDER_POLL_INTERVAL_MS);
        continue;
      }

      const size = await this.getFileSizeOrNull(outputFilePath);

      if (size !== null && size > 0) {
        if (size === lastSize) {
          stableTicks += 1;
          if (stableTicks >= STABILITY_REQUIRED_TICKS) {
            this.logger.info('Render tamamlandı (çıktı dosyası boyutu kararlı, render queue durumu okunamadı)', {
              outputFilePath,
              size,
            });
            return;
          }
        } else {
          stableTicks = 0;
        }
        lastSize = size;
      }

      await sleep(RENDER_POLL_INTERVAL_MS);
    }

    throw new RenderTimeoutError(`Render zaman aşımına uğradı: ${outputFilePath}`, {
      outputFilePath,
      renderQueueItemIndex,
      timeoutMs,
    });
  }

  private async getFileSizeOrNull(path: string): Promise<number | null> {
    try {
      const stats = await stat(path);
      return stats.size;
    } catch {
      return null;
    }
  }

  private async getRenderQueueItemStatus(
    outputFilePath: string,
    renderQueueItemIndex: number,
  ): Promise<number | null> {
    const jobRoot = dirname(dirname(outputFilePath));
    const reportFilePath = resolve(jobRoot, 'temp', 'render-status-report.txt');

    try {
      await this.jsxRuntime.runJsx(AdobeAppId.AFTER_EFFECTS, JsxScriptName.CHECK_RENDER_STATUS, {
        renderQueueItemIndex,
        reportFile: reportFilePath,
      });
      const raw = (await readFile(reportFilePath, 'utf-8')).trim();
      const status = Number(raw);
      return Number.isNaN(status) ? null : status;
    } catch {
      return null;
    }
  }

  private async pollUntilReady(): Promise<void> {
    for (;;) {
      if (await this.isRunning()) {
        return;
      }
      await sleep(READY_POLL_INTERVAL_MS);
    }
  }
}
