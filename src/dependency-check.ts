/**
 * Standalone verification entry point for the Phase 3 Dependency Package
 * architecture — proves extract → install fonts/presets → prepare
 * scripts → report plugins → verify → cache, end to end, against a
 * synthetic dependency-package.zip built by this script itself (no real
 * Laravel connection or real Adobe dependency file is needed).
 *
 * Font/preset installation targets are deliberately pointed at throwaway
 * scratch directories under the node workspace's temp/ folder — this
 * script NEVER writes into the real ~/Library/Fonts or a real Media
 * Encoder presets folder. Production wiring (once JobManager actually
 * uses this) would point FontInstallerService/PresetInstallerService at
 * the real OS locations instead.
 *
 * Run via `npm run check:dependency`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import { ZipExtractor } from './adobe/dependency/zip-extractor.js';
import { DependencyManifestReader } from './adobe/dependency/dependency-manifest-reader.js';
import { FontInstallerService } from './adobe/dependency/font-installer.service.js';
import { PresetInstallerService } from './adobe/dependency/preset-installer.service.js';
import { ScriptPreparerService } from './adobe/dependency/script-preparer.service.js';
import { LutInstallerService } from './adobe/dependency/lut-installer.service.js';
import { ExpressionInstallerService } from './adobe/dependency/expression-installer.service.js';
import { DependencyAssetInstallerService } from './adobe/dependency/dependency-asset-installer.service.js';
import { PluginReporterService } from './adobe/dependency/plugin-reporter.service.js';
import { DependencyVerificationService } from './adobe/dependency/dependency-verification.service.js';
import { DependencyCacheService } from './adobe/dependency/dependency-cache.service.js';
import { CloudFontActivatorService } from './adobe/dependency/cloud-font-activator.service.js';
import { ProcessManager } from './adobe/bridge/process-manager.js';
import { DependencyPackageService } from './adobe/dependency/dependency-package.service.js';
import { DependencyVerificationStatus } from './adobe/dependency/dependency-package.types.js';
import type { Logger } from './types/log.types.js';

async function buildFakeDependencyPackage(zipPath: string): Promise<void> {
  const zip = new AdmZip();

  zip.addFile(
    'dependencies.json',
    Buffer.from(
      JSON.stringify(
        {
          version: 1,
          fonts: [{ family: 'Montserrat', style: 'Bold', autoInstall: true }],
          plugins: [{ name: 'Saber', required: true, autoInstall: false }],
          presets: [{ name: 'Preview.epr' }],
          scripts: [{ name: 'prepare.jsx' }],
          luts: [{ name: 'Rec709.cube' }],
          expressions: [{ name: 'wiggle-helper.jsx' }],
          assets: [{ name: 'logo.png' }],
        },
        null,
        2,
      ),
    ),
  );
  zip.addFile('fonts/Montserrat-Bold.ttf', Buffer.from('fake font bytes'));
  zip.addFile('presets/Preview.epr', Buffer.from('<fake media encoder preset/>'));
  zip.addFile('scripts/prepare.jsx', Buffer.from('// fake jsx script'));
  zip.addFile('luts/Rec709.cube', Buffer.from('# fake lut bytes'));
  zip.addFile('expressions/wiggle-helper.jsx', Buffer.from('// fake expression snippet'));
  zip.addFile('assets/logo.png', Buffer.from('fake png bytes'));
  zip.addFile('readme.md', Buffer.from('# Test dependency package'));

  await mkdir(resolve(zipPath, '..'), { recursive: true });
  zip.writeZip(zipPath);
}

async function run(): Promise<void> {
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Dependency Package doğrulama senaryosu başlıyor');

  const workspaceService = new AdobeWorkspaceService(logger);
  const nodePaths = await workspaceService.ensure();

  // Scratch-only install targets — never the real system font/preset folders.
  const testFontsDir = resolve(nodePaths.temp, 'test-fonts');
  const testPresetsDir = resolve(nodePaths.temp, 'test-presets');
  const testLutsDir = resolve(nodePaths.temp, 'test-luts');
  const testExpressionsDir = resolve(nodePaths.temp, 'test-expressions');
  const dependencyPackagesCacheDir = resolve(nodePaths.cache, 'dependency-packages');
  const cacheFilePath = resolve(nodePaths.cache, 'dependency-cache.json');

  const dependencyPackageService = new DependencyPackageService(
    dependencyPackagesCacheDir,
    new ZipExtractor(logger),
    new DependencyManifestReader(),
    new FontInstallerService(testFontsDir, logger),
    new PresetInstallerService(testPresetsDir, logger),
    new ScriptPreparerService(logger),
    new LutInstallerService(testLutsDir, logger),
    new ExpressionInstallerService(testExpressionsDir, logger),
    new DependencyAssetInstallerService(logger),
    new PluginReporterService(logger),
    new DependencyVerificationService(logger),
    new DependencyCacheService(cacheFilePath, logger),
    new CloudFontActivatorService(new ProcessManager(logger), logger),
    logger,
  );

  const fakeRenderTemplateUuid = randomUUID();
  const fakeZipPath = resolve(nodePaths.temp, 'fake-dependency-package.zip');
  await buildFakeDependencyPackage(fakeZipPath);

  const jobUuid = randomUUID();
  const jobWorkspace = await workspaceService.createJobWorkspace(jobUuid);

  const firstRun = await dependencyPackageService.ensureInstalled(
    fakeRenderTemplateUuid,
    1,
    fakeZipPath,
    jobWorkspace,
  );
  logger.info('1. çalıştırma tamamlandı', {
    usedCache: firstRun.usedCache,
    status: firstRun.verification.status,
    fonts: firstRun.fonts,
    presets: firstRun.presets,
    scripts: firstRun.scripts,
    luts: firstRun.luts,
    expressions: firstRun.expressions,
    assets: firstRun.assets,
    plugins: firstRun.plugins,
  });

  // Second run, same template+version: should hit the cache (usedCache: true)
  // and skip re-extracting, proving the cache key from the spec works.
  const secondRun = await dependencyPackageService.ensureInstalled(
    fakeRenderTemplateUuid,
    1,
    fakeZipPath,
    jobWorkspace,
  );
  logger.info('2. çalıştırma tamamlandı (aynı versiyon)', {
    usedCache: secondRun.usedCache,
    status: secondRun.verification.status,
  });

  const success =
    firstRun.verification.status === DependencyVerificationStatus.READY &&
    !firstRun.usedCache &&
    secondRun.usedCache;

  // Clean up everything this script touched: the fake zip, the job
  // workspace, the scratch font/preset directories, and the cache files —
  // leaves no trace on the real system.
  await workspaceService.deleteJobWorkspace(jobUuid);
  await rm(fakeZipPath, { force: true });
  await rm(testFontsDir, { recursive: true, force: true });
  await rm(testPresetsDir, { recursive: true, force: true });
  await rm(testLutsDir, { recursive: true, force: true });
  await rm(testExpressionsDir, { recursive: true, force: true });
  await rm(dependencyPackagesCacheDir, { recursive: true, force: true });
  await rm(cacheFilePath, { force: true });

  if (success) {
    logger.info('Senaryo başarılı: extract, install, verify ve cache hepsi doğrulandı');
    process.exitCode = 0;
  } else {
    logger.error('Senaryo başarısız', {
      firstRunStatus: firstRun.verification.status,
      firstRunUsedCache: firstRun.usedCache,
      secondRunUsedCache: secondRun.usedCache,
    });
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Dependency Package doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
