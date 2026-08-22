export const DependencyVerificationStatus = {
  READY: 'READY',
  MISSING_DEPENDENCIES: 'MISSING_DEPENDENCIES',
} as const;

export type DependencyVerificationStatus =
  (typeof DependencyVerificationStatus)[keyof typeof DependencyVerificationStatus];

export interface FontInstallResult {
  installed: string[];
  skipped: string[];
}

export interface PresetInstallResult {
  installed: string[];
  skipped: string[];
}

export interface ScriptPrepareResult {
  prepared: string[];
  /** Already present in the job workspace from a prior prepare call. */
  skipped: string[];
  scriptsDirectory: string;
}

/** Added in Phase 4. */
export interface LutInstallResult {
  installed: string[];
  skipped: string[];
}

/** Added in Phase 4. */
export interface ExpressionInstallResult {
  installed: string[];
  skipped: string[];
}

/**
 * Added in Phase 4 — unlike fonts/presets/luts/expressions (shared,
 * node-wide), assets are staged into the job's own workspace: they are
 * generic project resources (images, footage, ...) scoped to this one job.
 */
export interface AssetInstallResult {
  installed: string[];
  skipped: string[];
  assetsDirectory: string;
}

/** Plugins are never installed — only reported, per the Phase 3 spec. */
export interface PluginReport {
  required: string[];
  optional: string[];
}

/** See CloudFontActivatorService — links opened in the default browser, never verified. */
export interface CloudFontActivationResult {
  opened: string[];
  failed: string[];
}

export interface DependencyVerificationResult {
  status: DependencyVerificationStatus;
  missingFonts: string[];
  missingPresets: string[];
  missingScripts: string[];
  /** Added in Phase 4. */
  missingLuts: string[];
  /** Added in Phase 4. */
  missingExpressions: string[];
  /** Added in Phase 4. */
  missingAssets: string[];
}

export interface DependencyInstallationReport {
  renderTemplateUuid: string;
  packageVersion: number;
  usedCache: boolean;
  fonts: FontInstallResult;
  presets: PresetInstallResult;
  scripts: ScriptPrepareResult;
  plugins: PluginReport;
  /** Added in Phase 4. */
  luts: LutInstallResult;
  /** Added in Phase 4. */
  expressions: ExpressionInstallResult;
  /** Added in Phase 4. */
  assets: AssetInstallResult;
  cloudFonts: CloudFontActivationResult;
  verification: DependencyVerificationResult;
}
