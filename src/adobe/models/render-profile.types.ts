export const RenderProfileCode = {
  PREVIEW: 'preview',
  MASTER: 'master',
} as const;

export type RenderProfileCode = (typeof RenderProfileCode)[keyof typeof RenderProfileCode];

/**
 * Renderer-specific settings — a generic, open bag (Faz 8B). A render
 * profile is a renderer-agnostic concept (name, watermark, active state);
 * whatever a specific renderer needs to configure a job lives in here
 * instead, so adding a new renderer setting — or a whole new renderer —
 * never requires touching `RenderProfile` itself. Today only
 * `ADOBE_OUTPUT_MODULE_TEMPLATE_KEY` is read (by
 * `getAdobeOutputModuleTemplate` below).
 */
export type RenderProfileRendererSettings = Record<string, unknown>;

/** The only key this phase's Adobe renderer reads from `rendererSettings` — a real, built-in AE Output Module template name (see docs/adobe-platform-constraints.md for why this must be configured explicitly). */
export const ADOBE_OUTPUT_MODULE_TEMPLATE_KEY = 'adobeOutputModuleTemplate';

/**
 * Text burned into the render as a real AE text layer when the profile's
 * `watermarkEnabled` is true (see queue-media-encoder.jsx) — e.g. the free
 * proxy tier's "PRATIKTOOLS ÖNİZLEME" watermark. Absent/non-string means
 * no watermark layer is added even if `watermarkEnabled` is true.
 */
export const WATERMARK_TEXT_KEY = 'watermarkText';

/**
 * AE Render Settings "Resolution" override (e.g. "Half", "Third") applied
 * via RenderQueueItem.setSettings() — separate from the Output Module
 * template above, and the only real lever for making the free proxy tier
 * genuinely faster (not just lower-bitrate). Absent means full resolution.
 * Best-effort: queue-media-encoder.jsx swallows failures here rather than
 * ever blocking a render over it (the exact settings key/value strings can
 * vary slightly by AE version/locale).
 */
export const RESOLUTION_FACTOR_KEY = 'resolutionFactor';

/**
 * A render output profile (Faz 8B: renderer-agnostic). `code` is a plain
 * string rather than a closed union — RenderProfileRegistry builds these
 * from config.json, so a deployment can define profiles beyond
 * preview/master (the Contract layer's own RenderProfileCode already
 * anticipates vertical/square/prores/alpha) without a code change here.
 */
export interface RenderProfile {
  code: string;
  name: string;
  watermarkEnabled: boolean;
  isActive: boolean;
  rendererSettings: RenderProfileRendererSettings;
}

/**
 * Reads the Adobe Output Module template out of a profile's generic
 * `rendererSettings` bag — the one place that knows this specific key
 * name, so callers never touch `rendererSettings` directly.
 */
export function getAdobeOutputModuleTemplate(profile: RenderProfile): string | null {
  const value = profile.rendererSettings[ADOBE_OUTPUT_MODULE_TEMPLATE_KEY];
  return typeof value === 'string' ? value : null;
}

/**
 * Only returns text when the profile actually wants a watermark
 * (`watermarkEnabled`) - a `watermarkText` present in `rendererSettings`
 * on a profile with `watermarkEnabled: false` (e.g. someone copy-pasting
 * config) is deliberately ignored rather than silently watermarking a
 * paid Master render.
 */
export function getWatermarkText(profile: RenderProfile): string | null {
  if (!profile.watermarkEnabled) {
    return null;
  }
  const value = profile.rendererSettings[WATERMARK_TEXT_KEY];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getResolutionFactor(profile: RenderProfile): string | null {
  const value = profile.rendererSettings[RESOLUTION_FACTOR_KEY];
  return typeof value === 'string' ? value : null;
}
