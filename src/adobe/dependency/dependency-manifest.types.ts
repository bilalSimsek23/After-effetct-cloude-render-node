/**
 * Shape of dependencies.json, found at the root of a dependency-package.zip.
 * No section is required — an empty package (no fonts/plugins/presets/
 * scripts) is valid.
 */
export interface DependencyFontEntry {
  family: string;
  style?: string;
  autoInstall?: boolean;
}

export interface DependencyPluginEntry {
  name: string;
  required?: boolean;
  /** Always false in this phase — plugins are reported, never installed. */
  autoInstall?: boolean;
}

export interface DependencyPresetEntry {
  name: string;
}

export interface DependencyScriptEntry {
  name: string;
}

/** Added in Phase 4. */
export interface DependencyLutEntry {
  name: string;
}

/** Added in Phase 4. */
export interface DependencyExpressionEntry {
  name: string;
}

/** Added in Phase 4 — generic files a dependency package carries (images, footage, ...) beyond the other typed sections. */
export interface DependencyAssetEntry {
  name: string;
}

export interface DependencyManifest {
  version: number;
  fonts?: DependencyFontEntry[];
  plugins?: DependencyPluginEntry[];
  presets?: DependencyPresetEntry[];
  scripts?: DependencyScriptEntry[];
  /** Added in Phase 4. */
  luts?: DependencyLutEntry[];
  /** Added in Phase 4. */
  expressions?: DependencyExpressionEntry[];
  /** Added in Phase 4. */
  assets?: DependencyAssetEntry[];
  /**
   * Adobe Fonts (or similar cloud-activated font service) URLs — not
   * files. These can't be bundled/redistributed as font files (license-
   * gated, activated per Creative Cloud account), so the manifest carries
   * the font's own page link instead; CloudFontActivatorService opens each
   * one so the operator can activate it on this machine's Creative Cloud
   * account.
   */
  cloudFontLinks?: string[];
}
