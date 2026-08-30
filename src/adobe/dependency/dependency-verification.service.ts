import type { Logger } from '../../types/log.types.js';
import type { DependencyManifest } from './dependency-manifest.types.js';
import type {
  FontInstallResult,
  PresetInstallResult,
  ScriptPrepareResult,
  LutInstallResult,
  ExpressionInstallResult,
  AssetInstallResult,
  DependencyVerificationResult,
} from './dependency-package.types.js';
import { DependencyVerificationStatus } from './dependency-package.types.js';

export interface InstalledDependencies {
  fonts: FontInstallResult;
  presets: PresetInstallResult;
  scripts: ScriptPrepareResult;
  luts: LutInstallResult;
  expressions: ExpressionInstallResult;
  assets: AssetInstallResult;
}

export interface IDependencyVerificationService {
  verify(
    manifest: DependencyManifest,
    installed: InstalledDependencies,
  ): DependencyVerificationResult;
}

/**
 * Compares what dependencies.json asked for against what actually landed
 * on disk, producing the READY / MISSING_DEPENDENCIES result the spec
 * calls for.
 *
 * Fonts can't be checked by exact filename — the manifest only describes
 * family/style, not a filename — so font verification only confirms the
 * fonts/ folder wasn't empty when the manifest declared fonts were
 * expected. Presets and scripts *do* have explicit "name" fields, so
 * those are checked precisely.
 */
export class DependencyVerificationService implements IDependencyVerificationService {
  constructor(private readonly logger: Logger) {}

  verify(
    manifest: DependencyManifest,
    installed: InstalledDependencies,
  ): DependencyVerificationResult {
    const missingFonts = this.verifyFonts(manifest, installed.fonts);
    const missingPresets = this.verifyByName(
      manifest.presets,
      installed.presets.installed,
      installed.presets.skipped,
    );
    const missingScripts = this.verifyByName(
      manifest.scripts,
      installed.scripts.prepared,
      installed.scripts.skipped,
    );
    const missingLuts = this.verifyByName(
      manifest.luts,
      installed.luts.installed,
      installed.luts.skipped,
    );
    const missingExpressions = this.verifyByName(
      manifest.expressions,
      installed.expressions.installed,
      installed.expressions.skipped,
    );
    const missingAssets = this.verifyByName(
      manifest.assets,
      installed.assets.installed,
      installed.assets.skipped,
    );

    const status =
      missingFonts.length === 0 &&
      missingPresets.length === 0 &&
      missingScripts.length === 0 &&
      missingLuts.length === 0 &&
      missingExpressions.length === 0 &&
      missingAssets.length === 0
        ? DependencyVerificationStatus.READY
        : DependencyVerificationStatus.MISSING_DEPENDENCIES;

    if (status === DependencyVerificationStatus.MISSING_DEPENDENCIES) {
      this.logger.error('Verification failed: missing dependencies', {
        missingFonts,
        missingPresets,
        missingScripts,
        missingLuts,
        missingExpressions,
        missingAssets,
      });
    } else {
      this.logger.info('Verification succeeded: all dependencies installed');
    }

    return {
      status,
      missingFonts,
      missingPresets,
      missingScripts,
      missingLuts,
      missingExpressions,
      missingAssets,
    };
  }

  private verifyFonts(manifest: DependencyManifest, fonts: FontInstallResult): string[] {
    const expectedCount = manifest.fonts?.length ?? 0;
    const actualCount = fonts.installed.length + fonts.skipped.length;

    if (expectedCount > 0 && actualCount === 0) {
      return (manifest.fonts ?? []).map((font) => font.family);
    }

    return [];
  }

  private verifyByName(
    expected: Array<{ name: string }> | undefined,
    ...presentGroups: string[][]
  ): string[] {
    const present = new Set(presentGroups.flat());
    return (expected ?? []).map((entry) => entry.name).filter((name) => !present.has(name));
  }
}
