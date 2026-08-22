import {
  RenderProfileCode,
  ADOBE_OUTPUT_MODULE_TEMPLATE_KEY,
  WATERMARK_TEXT_KEY,
  RESOLUTION_FACTOR_KEY,
} from './render-profile.types.js';
import type { RenderProfile } from './render-profile.types.js';
import type { RenderProfileConfigEntry } from '../../types/config.types.js';

/**
 * Used only when config.json doesn't define `renderProfiles` for a given
 * code — keeps existing config.json files working unchanged (Faz 8B).
 * Real deployments should define profiles in config.json instead of
 * relying on this fallback; it exists purely for backward compatibility
 * and zero-config operation.
 */
const FALLBACK_PROFILES: Record<string, RenderProfileConfigEntry> = {
  [RenderProfileCode.PREVIEW]: {
    name: 'Preview',
    watermarkEnabled: true,
    isActive: true,
    rendererSettings: {
      [ADOBE_OUTPUT_MODULE_TEMPLATE_KEY]: 'H.264 - Match Render Settings -  5 Mbps',
      [WATERMARK_TEXT_KEY]: 'MOTIONCURATE ÖNİZLEME',
      [RESOLUTION_FACTOR_KEY]: 'Half',
    },
  },
  [RenderProfileCode.MASTER]: {
    name: 'Master',
    watermarkEnabled: false,
    isActive: true,
    rendererSettings: {
      [ADOBE_OUTPUT_MODULE_TEMPLATE_KEY]: 'H.264 - Match Render Settings - 40 Mbps',
    },
  },
};

/**
 * Holds the render profiles Execution Pipeline jobs are submitted with.
 * Renderer-agnostic (Faz 8B): built entirely from config.json's
 * `renderProfiles` (falling back to FALLBACK_PROFILES per-code when a
 * code is missing from config) — this class never hardcodes an Adobe
 * template name itself, only the generic shape.
 */
export class RenderProfileRegistry {
  private readonly profiles: RenderProfile[];

  constructor(configProfiles?: Record<string, RenderProfileConfigEntry>) {
    const merged: Record<string, RenderProfileConfigEntry> = {
      ...FALLBACK_PROFILES,
      ...configProfiles,
    };
    this.profiles = Object.entries(merged).map(([code, entry]) => ({ code, ...entry }));
  }

  list(): RenderProfile[] {
    return [...this.profiles];
  }

  find(code: string): RenderProfile | undefined {
    return this.profiles.find((profile) => profile.code === code);
  }
}
