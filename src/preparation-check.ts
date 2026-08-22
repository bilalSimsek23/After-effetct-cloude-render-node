/**
 * Standalone verification for the Phase 4 Project Preparation Pipeline —
 * proves Job Workspace → Template download → Dependency Package install →
 * Project (.aep) extraction → Manifest validation → variables.json, end to
 * end, against a synthetic nested template package (outer zip →
 * project.aegraphic → project.aep + manifest.json) built by this script
 * itself — no real Laravel connection is needed.
 *
 * The nested-archive shape (outer zip → inner .aegraphic zip → .aep) is
 * modeled after a real Envato-style MOGRT export, verified by hand against
 * a genuine sample product during development; this script uses synthetic
 * bytes so it stays fully self-contained and reproducible, same as
 * dependency-check.ts's own synthetic dependency-package.zip.
 *
 * Run via `npm run check:preparation`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import { createDefaultContractRegistry } from './contracts/registry/default-contract-registry.js';
import { createManifestContract } from './contracts/manifest.contract.js';
import type { ManifestContract } from './contracts/manifest.contract.js';
import { createTemplateVariableContract } from './contracts/template-variable.contract.js';
import {
  createRenderJobContract,
  RenderJobPriority,
  RenderJobRenderType,
} from './contracts/render-job.contract.js';
import { createCapabilityReportContract } from './contracts/capability-report.contract.js';
import type { CapabilityReportContract } from './contracts/capability-report.contract.js';
import { RenderProfileCode } from './contracts/render-profile.contract.js';
import { CapabilityRegistry } from './capabilities/capability-registry.js';
import type { ICapabilityProvider } from './capabilities/capability-provider.interface.js';
import type {
  CapabilityAdobeInfo,
  CapabilityHardwareInfo,
  CapabilityInstalledPluginEntry,
} from './contracts/capability-report.contract.js';
import type { OperatingSystemInfo } from './capabilities/providers/operating-system-capability.provider.js';
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
import { TemplateCacheService } from './preparation/template-cache.service.js';
import { TemplateDownloadService } from './preparation/template-download.service.js';
import { ProjectExtractor } from './preparation/project-extractor.js';
import { ProjectValidator } from './preparation/project-validator.js';
import { VariableFileBuilder } from './preparation/variable-file-builder.js';
import {
  ProjectPreparationService,
  NodeNotCapableError,
} from './preparation/project-preparation.service.js';
import { PreparedProjectStatus } from './preparation/prepared-project.types.js';
import { hashFileSha256 } from './utils/hash-file.js';
import type { IProgressService } from './services/progress.service.js';
import type { ILaravelApiClient } from './api/laravel-api.client.js';
import type { Logger } from './types/log.types.js';

async function buildFakeTemplatePackage(
  zipPath: string,
  manifest: ManifestContract,
): Promise<void> {
  const innerZip = new AdmZip();
  innerZip.addFile('project.aep', Buffer.from('fake after effects project bytes'));
  innerZip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

  const outerZip = new AdmZip();
  outerZip.addFile('project.aegraphic', innerZip.toBuffer());
  outerZip.addFile('definition.json', Buffer.from('{}'));

  await mkdir(resolve(zipPath, '..'), { recursive: true });
  outerZip.writeZip(zipPath);
}

async function buildFakeDependencyPackage(zipPath: string): Promise<void> {
  const zip = new AdmZip();

  zip.addFile(
    'dependencies.json',
    Buffer.from(
      JSON.stringify(
        {
          version: 1,
          fonts: [{ family: 'Montserrat', style: 'Bold', autoInstall: true }],
          plugins: [],
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

  await mkdir(resolve(zipPath, '..'), { recursive: true });
  zip.writeZip(zipPath);
}

function noopProvider<T>(name: string, value: T): ICapabilityProvider<T> {
  return {
    name,
    collect: async () => value,
  };
}

function buildCapabilityReport(supportedEngines: string[]): CapabilityReportContract {
  return createCapabilityReportContract({
    nodeUuid: randomUUID(),
    nodeName: 'Test Node',
    hostname: 'test-host',
    operatingSystem: 'darwin 25.5.0',
    architecture: 'arm64',
    adobe: {
      afterEffectsVersion: '26.3.0',
      mediaEncoderVersion: '26.3.1',
      dynamicLinkAvailable: true,
    },
    supportedEngines,
    supportedRenderProfiles: [RenderProfileCode.PREVIEW],
    fontPackageVersion: null,
    installedPlugins: [],
    supportedFormats: [],
    hardware: {
      cpuModel: 'Apple M2 Pro',
      cpuCores: 12,
      ramTotalBytes: 17179869184,
      gpuModel: null,
      gpuMemoryBytes: null,
      diskFreeBytes: null,
      diskTotalBytes: null,
    },
    performance: { maxConcurrentJobs: 4, currentRunningJobs: 0, maxQueueLength: 10 },
  });
}

async function run(): Promise<void> {
  const nodeIdentity = new NodeIdentityService();
  nodeIdentity.setNodeUuid(randomUUID());
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Project Preparation Pipeline doğrulama senaryosu başlıyor');

  const workspaceService = new AdobeWorkspaceService(logger);
  const nodePaths = await workspaceService.ensure();
  const contractRegistry = createDefaultContractRegistry();

  // Scratch-only install targets — never the real system font/preset folders.
  const testFontsDir = resolve(nodePaths.temp, 'prep-test-fonts');
  const testPresetsDir = resolve(nodePaths.temp, 'prep-test-presets');
  const testLutsDir = resolve(nodePaths.temp, 'prep-test-luts');
  const testExpressionsDir = resolve(nodePaths.temp, 'prep-test-expressions');
  const dependencyPackagesCacheDir = resolve(nodePaths.cache, 'prep-test-dependency-packages');
  const dependencyCacheFilePath = resolve(nodePaths.cache, 'prep-test-dependency-cache.json');
  const templateCacheFilePath = resolve(nodePaths.cache, 'prep-test-template-cache.json');

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
    new DependencyCacheService(dependencyCacheFilePath, logger),
    new CloudFontActivatorService(new ProcessManager(logger), logger),
    logger,
  );

  const templateDownloadService = new TemplateDownloadService(
    new TemplateCacheService(templateCacheFilePath, logger),
    logger,
  );

  // A CapabilityRegistry instance is only needed here for its pure
  // supports() method, which never calls into any provider — the
  // providers below only exist to satisfy the constructor's type, and are
  // never actually invoked (real provider collection is
  // capabilities-check.ts's job, not this script's).
  const adobeInfo: CapabilityAdobeInfo = {
    afterEffectsVersion: null,
    mediaEncoderVersion: null,
    dynamicLinkAvailable: false,
  };
  const hardwareInfo: CapabilityHardwareInfo = {
    cpuModel: 'Apple M2 Pro',
    cpuCores: 12,
    ramTotalBytes: 17179869184,
    gpuModel: null,
    gpuMemoryBytes: null,
    diskFreeBytes: null,
    diskTotalBytes: null,
  };
  const osInfo: OperatingSystemInfo = {
    hostname: 'test-host',
    operatingSystem: 'darwin 25.5.0',
    architecture: 'arm64',
  };
  const installedPlugins: CapabilityInstalledPluginEntry[] = [];

  const capabilityRegistry = new CapabilityRegistry({
    nodeUuid: randomUUID(),
    nodeName: 'Test Node',
    supportedEngines: ['after-effects'],
    supportedFormats: [],
    getPerformance: () => ({ maxConcurrentJobs: 4, currentRunningJobs: 0, maxQueueLength: 10 }),
    providers: {
      adobe: noopProvider('adobe', adobeInfo),
      hardware: noopProvider('hardware', hardwareInfo),
      font: noopProvider<string | null>('font', null),
      plugin: noopProvider('plugin', installedPlugins),
      renderProfile: noopProvider('render-profile', [RenderProfileCode.PREVIEW]),
      operatingSystem: noopProvider('operating-system', osInfo),
    },
    contractRegistry,
    logger,
  });

  // This check script verifies Project Preparation in isolation, no real
  // Laravel connection — a no-op IProgressService is enough here (Faz 3A's
  // granular sub-stage reporting is exercised for real by check:orchestrator
  // instead, which already has a full ProgressForwarder wired).
  const noopProgressService: IProgressService = { stage: async () => {} };

  // This check script's fixtures never declare a media (IMAGE/VIDEO/AUDIO)
  // variable, so ProjectPreparationService's variable-asset download step
  // never actually calls into this — a throwing stub is enough for every
  // method, same spirit as noopProgressService above.
  const notUsedHere = async (): Promise<never> => {
    throw new Error('preparation-check.ts fixtures never call ILaravelApiClient');
  };
  const noopLaravelApiClient: ILaravelApiClient = {
    register: notUsedHere,
    heartbeat: notUsedHere,
    claimJob: notUsedHere,
    jobProgress: notUsedHere,
    jobCompleted: notUsedHere,
    jobFailed: notUsedHere,
    reportSystemStatus: notUsedHere,
    getDependencyPackage: notUsedHere,
    getTemplateAsset: notUsedHere,
    sendJobHeartbeat: notUsedHere,
    claimRenderJob: notUsedHere,
    declineRenderJob: notUsedHere,
    sendJobProgress: notUsedHere,
    sendJobCompleted: notUsedHere,
    sendJobFailed: notUsedHere,
    downloadAsset: notUsedHere,
  };

  const projectPreparationService = new ProjectPreparationService(
    workspaceService,
    capabilityRegistry,
    noopLaravelApiClient,
    templateDownloadService,
    dependencyPackageService,
    new ProjectExtractor(logger),
    new ProjectValidator(contractRegistry, logger),
    new VariableFileBuilder(logger),
    noopProgressService,
    logger,
  );

  const manifest = createManifestContract({
    schemaVersion: '1.0.0',
    scannerVersion: '1.0.0',
    engine: 'after-effects',
    variables: [
      createTemplateVariableContract({
        key: 'title_text',
        label: 'Title Text',
        type: 'text',
        defaultValue: null,
        sortOrder: 0,
        metadata: null,
      }),
      createTemplateVariableContract({
        key: 'subtitle_text',
        label: 'Subtitle Text',
        type: 'text',
        defaultValue: 'Varsayılan Alt Başlık',
        sortOrder: 1,
        metadata: null,
      }),
    ],
    metadata: {},
  });

  // Mirrors what RenderJobSnapshotBuilder.php's 'template' blob would carry
  // for this same manifest — the real manifest source ProjectValidator now
  // builds from directly (never a manifest.json inside the downloaded zip).
  const templateManifestSource = {
    engine: manifest.engine,
    renderComposition: null,
    requiresAlpha: false,
    renderDurationSeconds: null,
    variables: manifest.variables.map((variable) => ({
      key: variable.key,
      label: variable.label,
      type: variable.type,
      defaultValue: variable.defaultValue,
      sortOrder: variable.sortOrder,
      metadata: variable.metadata,
    })),
  };

  const templateUuid = randomUUID();
  const fakeTemplatePackagePath = resolve(nodePaths.temp, 'fake-template-package.zip');
  await buildFakeTemplatePackage(fakeTemplatePackagePath, manifest);
  // Faz 3A - register this fixture's real hash so the mock's checksum
  // verification genuinely matches instead of permanently failing.
  const expectedProjectAssetHash = await hashFileSha256(fakeTemplatePackagePath);

  const fakeDependencyPackagePath = resolve(nodePaths.temp, 'fake-dependency-package-prep.zip');
  await buildFakeDependencyPackage(fakeDependencyPackagePath);

  const renderJob = createRenderJobContract({
    jobUuid: randomUUID(),
    templateUuid,
    projectUuid: randomUUID(),
    userUuid: randomUUID(),
    variables: { title_text: 'Merhaba Dünya' },
    priority: RenderJobPriority.NORMAL,
    renderType: RenderJobRenderType.PREVIEW,
  });

  const capableReport = buildCapabilityReport(['after-effects']);
  const incapableReport = buildCapabilityReport(['premiere-pro']);

  let allPassed = true;

  const firstRun = await projectPreparationService.prepare({
    renderJob,
    engine: 'after-effects',
    capabilityReport: capableReport,
    localTemplateAssetFilePath: fakeTemplatePackagePath,
    expectedProjectAssetHash,
    templateManifestSource,
    localDependencyPackageZipPath: fakeDependencyPackagePath,
    dependencyPackageVersion: 1,
    variableAssets: {},
  });

  logger.info('1. çalıştırma tamamlandı', {
    status: firstRun.status,
    projectFilePath: firstRun.projectFilePath,
    variablesFilePath: firstRun.variablesFilePath,
    errors: firstRun.errors,
  });

  if (firstRun.status !== PreparedProjectStatus.READY) {
    allPassed = false;
    logger.error('FAIL: 1. çalıştırma READY değil', { errors: firstRun.errors });
  }

  if (firstRun.projectFilePath) {
    await stat(firstRun.projectFilePath).catch(() => {
      allPassed = false;
      logger.error('FAIL: projectFilePath diskte yok', { path: firstRun.projectFilePath });
    });
  } else {
    allPassed = false;
  }

  let writtenVariables: Record<string, unknown> = {};
  if (firstRun.variablesFilePath) {
    try {
      writtenVariables = JSON.parse(await readFile(firstRun.variablesFilePath, 'utf-8'));
    } catch {
      allPassed = false;
      logger.error('FAIL: variables.json okunamadı/parse edilemedi', {
        path: firstRun.variablesFilePath,
      });
    }
  } else {
    allPassed = false;
  }

  const expectedVariables = { title_text: 'Merhaba Dünya', subtitle_text: 'Varsayılan Alt Başlık' };
  const variablesMatch = JSON.stringify(writtenVariables) === JSON.stringify(expectedVariables);
  logger.info('variables.json içeriği', { writtenVariables, expectedVariables, variablesMatch });
  if (!variablesMatch) {
    allPassed = false;
    logger.error('FAIL: variables.json beklenen içerikle eşleşmiyor');
  }

  // Second run, same templateUuid + same local files: both the Template
  // asset cache and the Dependency Package cache should hit.
  const secondJobUuid = randomUUID();
  const secondRenderJob = createRenderJobContract({
    jobUuid: secondJobUuid,
    templateUuid,
    projectUuid: renderJob.projectUuid,
    userUuid: renderJob.userUuid,
    variables: { title_text: 'İkinci Çalıştırma' },
    priority: RenderJobPriority.NORMAL,
    renderType: RenderJobRenderType.PREVIEW,
  });

  const secondRun = await projectPreparationService.prepare({
    renderJob: secondRenderJob,
    engine: 'after-effects',
    capabilityReport: capableReport,
    localTemplateAssetFilePath: fakeTemplatePackagePath,
    expectedProjectAssetHash,
    templateManifestSource,
    localDependencyPackageZipPath: fakeDependencyPackagePath,
    dependencyPackageVersion: 1,
    variableAssets: {},
  });

  logger.info('2. çalıştırma tamamlandı (aynı template + aynı bağımlılık versiyonu)', {
    status: secondRun.status,
  });

  if (secondRun.status !== PreparedProjectStatus.READY) {
    allPassed = false;
    logger.error('FAIL: 2. çalıştırma READY değil', { errors: secondRun.errors });
  }

  // Capability pre-check: a node missing the required engine must be
  // rejected before any workspace/download work starts.
  let nodeNotCapableThrown = false;
  try {
    await projectPreparationService.prepare({
      renderJob: createRenderJobContract({
        jobUuid: randomUUID(),
        templateUuid,
        projectUuid: renderJob.projectUuid,
        userUuid: renderJob.userUuid,
        variables: { title_text: 'Yetersiz Node' },
        priority: RenderJobPriority.NORMAL,
        renderType: RenderJobRenderType.PREVIEW,
      }),
      engine: 'after-effects',
      capabilityReport: incapableReport,
      localTemplateAssetFilePath: fakeTemplatePackagePath,
      expectedProjectAssetHash,
      templateManifestSource,
      localDependencyPackageZipPath: fakeDependencyPackagePath,
      dependencyPackageVersion: 1,
      variableAssets: {},
    });
  } catch (error) {
    nodeNotCapableThrown = error instanceof NodeNotCapableError;
  }

  logger.info('Capability Registry ön-kontrolü sonucu', { nodeNotCapableThrown });
  if (!nodeNotCapableThrown) {
    allPassed = false;
    logger.error('FAIL: yetersiz node için NodeNotCapableError fırlatılmadı');
  }

  // Clean up everything this script touched.
  await workspaceService.deleteJobWorkspace(renderJob.jobUuid);
  await workspaceService.deleteJobWorkspace(secondJobUuid);
  await rm(fakeTemplatePackagePath, { force: true });
  await rm(fakeDependencyPackagePath, { force: true });
  await rm(testFontsDir, { recursive: true, force: true });
  await rm(testPresetsDir, { recursive: true, force: true });
  await rm(testLutsDir, { recursive: true, force: true });
  await rm(testExpressionsDir, { recursive: true, force: true });
  await rm(dependencyPackagesCacheDir, { recursive: true, force: true });
  await rm(dependencyCacheFilePath, { force: true });
  await rm(templateCacheFilePath, { force: true });

  if (allPassed) {
    logger.info(
      'Senaryo başarılı: Project Preparation Pipeline uçtan uca doğrulandı (extraction, manifest, variables.json, cache, capability ön-kontrolü)',
    );
    process.exitCode = 0;
  } else {
    logger.error('Senaryo başarısız');
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Project Preparation Pipeline doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
