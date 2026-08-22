import { resolve } from 'node:path';
import type { IZipExtractor } from './zip-extractor.js';
import type { IDependencyManifestReader } from './dependency-manifest-reader.js';
import type { IFontInstallerService } from './font-installer.service.js';
import type { IPresetInstallerService } from './preset-installer.service.js';
import type { IScriptPreparerService } from './script-preparer.service.js';
import type { ILutInstallerService } from './lut-installer.service.js';
import type { IExpressionInstallerService } from './expression-installer.service.js';
import type { IDependencyAssetInstallerService } from './dependency-asset-installer.service.js';
import type { IPluginReporterService } from './plugin-reporter.service.js';
import type { IDependencyVerificationService } from './dependency-verification.service.js';
import type { IDependencyCacheService } from './dependency-cache.service.js';
import type { ICloudFontActivatorService } from './cloud-font-activator.service.js';
import type { JobWorkspacePaths } from '../runtime/adobe-workspace.service.js';
import type { Logger } from '../../types/log.types.js';
import type { CloudFontActivationResult, DependencyInstallationReport } from './dependency-package.types.js';

export interface IDependencyPackageService {
  ensureInstalled(
    renderTemplateUuid: string,
    packageVersion: number,
    localZipPath: string,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<DependencyInstallationReport>;
}

/**
 * Orchestrates the "Render Node'un Görevi" install flow: extract (cached
 * by render_template_uuid + package_version), install fonts/presets,
 * prepare scripts into the job's own workspace, report plugins, then
 * verify everything landed. Downloading the ZIP itself is out of scope
 * for this phase — callers already have a local zip path (however it got
 * there); this service only owns what happens once that file exists.
 */
export class DependencyPackageService implements IDependencyPackageService {
  constructor(
    private readonly dependencyPackagesCacheDir: string,
    private readonly zipExtractor: IZipExtractor,
    private readonly manifestReader: IDependencyManifestReader,
    private readonly fontInstaller: IFontInstallerService,
    private readonly presetInstaller: IPresetInstallerService,
    private readonly scriptPreparer: IScriptPreparerService,
    private readonly lutInstaller: ILutInstallerService,
    private readonly expressionInstaller: IExpressionInstallerService,
    private readonly assetInstaller: IDependencyAssetInstallerService,
    private readonly pluginReporter: IPluginReporterService,
    private readonly verificationService: IDependencyVerificationService,
    private readonly cacheService: IDependencyCacheService,
    private readonly cloudFontActivator: ICloudFontActivatorService,
    private readonly logger: Logger,
  ) {}

  async ensureInstalled(
    renderTemplateUuid: string,
    packageVersion: number,
    localZipPath: string,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<DependencyInstallationReport> {
    const extractedDir = this.resolveExtractedDir(renderTemplateUuid, packageVersion);
    const cachedVersion = await this.cacheService.get(renderTemplateUuid);
    const usedCache = cachedVersion === packageVersion;

    if (usedCache) {
      this.logger.info('Dependency package cache hit, extract atlanıyor', {
        renderTemplateUuid,
        packageVersion,
      });
    } else {
      await this.zipExtractor.extract(localZipPath, extractedDir);
      await this.cacheService.set(renderTemplateUuid, packageVersion);
    }

    const manifest = await this.manifestReader.read(extractedDir);

    // Font/preset installers are idempotent (they skip files that already
    // exist), so re-running them on a cache hit is cheap and correct —
    // only the extract step itself is actually skipped above.
    const fonts = await this.fontInstaller.installFonts(extractedDir);
    const presets = await this.presetInstaller.installPresets(extractedDir);
    const scripts = await this.scriptPreparer.prepareScripts(extractedDir, jobWorkspace);
    const luts = await this.lutInstaller.installLuts(extractedDir);
    const expressions = await this.expressionInstaller.installExpressions(extractedDir);
    const assets = await this.assetInstaller.installAssets(extractedDir, jobWorkspace);
    const plugins = this.pluginReporter.reportPlugins(manifest);

    // Only opened the first time this exact template+version is seen on
    // this machine (usedCache=false) - once an operator has activated a
    // font here, re-opening the same link on every subsequent render of
    // the same template would just be noise. A cache clear or a different
    // machine naturally re-triggers this, matching the underlying "has
    // this actually been set up here" question the cache already answers
    // for fonts/presets/etc.
    const cloudFonts: CloudFontActivationResult = usedCache
      ? { opened: [], failed: [] }
      : await this.cloudFontActivator.activateCloudFonts(manifest.cloudFontLinks ?? []);

    const verification = this.verificationService.verify(manifest, {
      fonts,
      presets,
      scripts,
      luts,
      expressions,
      assets,
    });

    return {
      renderTemplateUuid,
      packageVersion,
      usedCache,
      fonts,
      presets,
      scripts,
      luts,
      expressions,
      assets,
      plugins,
      cloudFonts,
      verification,
    };
  }

  private resolveExtractedDir(renderTemplateUuid: string, packageVersion: number): string {
    return resolve(this.dependencyPackagesCacheDir, renderTemplateUuid, String(packageVersion));
  }
}
