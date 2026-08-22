import { readFile } from 'node:fs/promises';
import { AdobeAppId } from '../../adobe/models/adobe-app-id.js';
import { JsxScriptName } from '../../jsx/jsx-script-name.js';
import type { IJsxRuntimeService } from '../../jsx/jsx-runtime.service.js';
import type { ICapabilityProvider } from '../capability-provider.interface.js';
import type { Logger } from '../../types/log.types.js';

/**
 * Real, one-time Adobe runtime capability info (Faz 8B) — every boolean
 * here is a genuinely executed check against this machine's actual AE
 * build (see detect-capabilities.jsx), never assumed from a version
 * number. Not yet part of CapabilityReportContract: adding fields to that
 * Contract needs its own versioned, explicitly approved phase. Until
 * then this lives as a separate, internal capability
 * (CapabilityRegistry.getRuntimeCapabilities()) — collected once at node
 * registration, logged, cached, never re-probed per job.
 */
export interface AdobeRuntimeCapabilities {
  /** Which IRenderEngine implementation is wired in — a static Node-side fact, not probed from AE. */
  renderEngineMode: string;
  supportsJSON: boolean;
  supportsFontsApi: boolean;
  supportsRenderQueue: boolean;
  supportsRenderQueueStatusEnum: boolean;
  installedOutputModuleTemplates: string[];
  probeError: string | null;
}

interface ProbedCapabilities {
  supportsJSON: boolean;
  supportsFontsApi: boolean;
  supportsRenderQueue: boolean;
  supportsRenderQueueStatusEnum: boolean;
  installedOutputModuleTemplates: string[];
  probeError: string | null;
}

export class AdobeRuntimeCapabilityProvider implements ICapabilityProvider<AdobeRuntimeCapabilities> {
  readonly name = 'adobe-runtime-capabilities';

  constructor(
    private readonly jsxRuntime: IJsxRuntimeService,
    private readonly reportFilePath: string,
    private readonly renderEngineMode: string,
    private readonly logger: Logger,
  ) {}

  async collect(): Promise<AdobeRuntimeCapabilities> {
    await this.jsxRuntime.runJsx(AdobeAppId.AFTER_EFFECTS, JsxScriptName.DETECT_CAPABILITIES, {
      reportFile: this.reportFilePath,
    });

    const raw = await readFile(this.reportFilePath, 'utf-8');
    const probed = JSON.parse(raw) as ProbedCapabilities;

    if (probed.probeError) {
      this.logger.warn('Adobe runtime capability probe kısmen başarısız oldu', {
        probeError: probed.probeError,
      });
    }

    return { renderEngineMode: this.renderEngineMode, ...probed };
  }
}
