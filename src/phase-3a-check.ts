/**
 * Faz 3A doğrulama senaryosu — Execution Lifecycle'a eklenen 6 gerçek
 * boşluğun her biri için odaklı, gerçek (mock değil) davranış kontrolü:
 *
 *   1. Proje asset checksum doğrulaması (TemplateDownloadService)
 *   2. Bağımlılık paketi indirme/doğrulama hata kodları (ProjectPreparationService)
 *   3. Job Workspace oluşturma hatası kodu (ProjectPreparationService)
 *   4. Granular execution-state ilerleme raporlama sırası (ProjectPreparationService)
 *   5. renderComposition bulunamadı → RENDER_CONFIGURATION_INVALID (AfterEffectsRenderEngine)
 *   6. ffprobe çıktı metadata toplama (yalnızca bu makinede ffprobe kuruluysa)
 *
 * Gerçek Adobe After Effects GEREKTİRMEZ (bu repodaki diğer check:*
 * script'lerinin çoğunun aksine) — hiçbiri gerçek bir Adobe oturumu açmıyor;
 * hepsi bu fazda eklenen TypeScript/mantık katmanını, sahte (ama arayüze
 * tam uyan) servis implementasyonlarıyla doğruluyor. Gerçek Adobe/comp/
 * render davranışının kendisi (kullanıcının "Manuel Doğrulama" listesi)
 * hâlâ elle doğrulanmalı — bu script yalnızca yeni eklenen mantığın
 * kendisini kanıtlar.
 *
 * Run via `npm run check:phase3a`.
 */
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import type { JobWorkspacePaths } from './adobe/runtime/adobe-workspace.service.js';
import { createDefaultContractRegistry } from './contracts/registry/default-contract-registry.js';
import { createManifestContract } from './contracts/manifest.contract.js';
import type { ManifestContract } from './contracts/manifest.contract.js';
import {
  createRenderJobContract,
  RenderJobPriority,
  RenderJobRenderType,
} from './contracts/render-job.contract.js';
import type { RenderJobContract } from './contracts/render-job.contract.js';
import type { CapabilityReportContract } from './contracts/capability-report.contract.js';
import { createCapabilityReportContract } from './contracts/capability-report.contract.js';
import { RenderProfileCode } from './contracts/render-profile.contract.js';
import { CapabilityRegistry } from './capabilities/capability-registry.js';
import type { ICapabilityProvider } from './capabilities/capability-provider.interface.js';
import { TemplateDownloadService } from './preparation/template-download.service.js';
import { TemplateDownloadError } from './preparation/template-download.service.js';
import type { ITemplateCacheService } from './preparation/template-cache.service.js';
import { ProjectPreparationService } from './preparation/project-preparation.service.js';
import type {
  IProjectPreparationService,
  ProjectPreparationInput,
} from './preparation/project-preparation.service.js';
import type { ITemplateDownloadService } from './preparation/template-download.service.js';
import type { IProjectExtractor } from './preparation/project-extractor.js';
import type { IProjectValidator } from './preparation/project-validator.js';
import type { IVariableFileBuilder } from './preparation/variable-file-builder.js';
import type { IDependencyPackageService } from './adobe/dependency/dependency-package.service.js';
import {
  DependencyVerificationStatus,
  type DependencyInstallationReport,
} from './adobe/dependency/dependency-package.types.js';
import { PreparedProjectStatus } from './preparation/prepared-project.types.js';
import { ExecutionStageName, type IProgressService } from './services/progress.service.js';
import { AfterEffectsRenderEngine } from './adobe/engines/after-effects-render.engine.js';
import type { IAdobeBridge } from './adobe/bridge/adobe-bridge.js';
import type { IJsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { RenderConfigurationError, RenderQueueError } from './jsx/variable-application.types.js';
import { ErrorCode } from './errors/error-code.js';
import { collectOutputMetadata } from './utils/ffprobe-metadata.js';
import { hashFileSha256 } from './utils/hash-file.js';
import type { ILaravelApiClient } from './api/laravel-api.client.js';
import type { Logger } from './types/log.types.js';

const execFileAsync = promisify(execFile);

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push(detail !== undefined ? { name, passed, detail } : { name, passed });
}

function noopProvider<T>(name: string, value: T): ICapabilityProvider<T> {
  return { name, collect: async () => value };
}

function buildCapabilityReport(): CapabilityReportContract {
  return createCapabilityReportContract({
    nodeUuid: randomUUID(),
    nodeName: 'Phase 3A Check Node',
    hostname: 'test-host',
    operatingSystem: 'darwin 25.5.0',
    architecture: 'arm64',
    adobe: { afterEffectsVersion: '26.3.0', mediaEncoderVersion: '26.3.1', dynamicLinkAvailable: true },
    supportedEngines: ['after-effects'],
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

function buildRenderJob(): RenderJobContract {
  return createRenderJobContract({
    jobUuid: randomUUID(),
    templateUuid: randomUUID(),
    projectUuid: randomUUID(),
    userUuid: randomUUID(),
    variables: {},
    priority: RenderJobPriority.NORMAL,
    renderType: RenderJobRenderType.PREVIEW,
  });
}

// ---- 1. Project asset checksum verification ----

async function checkChecksumVerification(logger: Logger): Promise<void> {
  const workspaceService = new AdobeWorkspaceService(logger);
  const nodePaths = await workspaceService.ensure();

  const localFilePath = resolve(nodePaths.temp, `phase3a-checksum-${randomUUID()}.bin`);
  await writeFile(localFilePath, Buffer.from('gerçek proje dosyası gibi davranan test byte dizisi'));
  const realHash = await hashFileSha256(localFilePath);

  const jobWorkspace = await workspaceService.createJobWorkspace(`checksum-${randomUUID()}`);

  const cache = new (class implements ITemplateCacheService {
    async get(): Promise<string | null> {
      return null;
    }
    async set(): Promise<void> {}
  })();

  function buildService(): TemplateDownloadService {
    return new TemplateDownloadService(cache, logger);
  }

  // Mismatch — must throw.
  try {
    await buildService().download(
      randomUUID(),
      localFilePath,
      jobWorkspace,
      '0000000000000000000000000000000000000000000000000000000000000000',
    );
    record('Checksum uyuşmazlığı reddediliyor', false, 'Beklenen hata fırlatılmadı');
  } catch (error) {
    record(
      'Checksum uyuşmazlığı reddediliyor',
      error instanceof TemplateDownloadError,
      (error as Error).message,
    );
  }

  // Match — must succeed.
  try {
    const result = await buildService().download(randomUUID(), localFilePath, jobWorkspace, realHash);
    record('Checksum eşleşmesi kabul ediliyor', result.assetHash === realHash);
  } catch (error) {
    record('Checksum eşleşmesi kabul ediliyor', false, (error as Error).message);
  }

  await workspaceService.deleteJobWorkspace(jobWorkspace.jobUuid);
  await rm(localFilePath, { force: true });
}

// ---- 2-4. ProjectPreparationService: error codes + progress stage order ----

function stubPreparationDeps(overrides: {
  workspaceService?: AdobeWorkspaceService;
  laravelApiClient?: ILaravelApiClient;
  templateDownloadService?: ITemplateDownloadService;
  dependencyPackageService?: IDependencyPackageService;
  projectExtractor?: IProjectExtractor;
  projectValidator?: IProjectValidator;
  variableFileBuilder?: IVariableFileBuilder;
  progressService?: IProgressService;
  logger: Logger;
  workspaceService_: AdobeWorkspaceService;
}): IProjectPreparationService {
  const manifest: ManifestContract = createManifestContract({
    schemaVersion: '1.0.0',
    scannerVersion: '1.0.0',
    engine: 'after-effects',
    variables: [],
    metadata: { renderComposition: null, requiresAlpha: false, renderDurationSeconds: null },
  });

  const capabilityRegistry = new CapabilityRegistry({
    nodeUuid: randomUUID(),
    nodeName: 'Phase 3A Check Node',
    supportedEngines: ['after-effects'],
    supportedFormats: [],
    getPerformance: () => ({ maxConcurrentJobs: 4, currentRunningJobs: 0, maxQueueLength: 10 }),
    providers: {
      adobe: noopProvider('adobe', {
        afterEffectsVersion: null,
        mediaEncoderVersion: null,
        dynamicLinkAvailable: false,
      }),
      hardware: noopProvider('hardware', {
        cpuModel: 'test-cpu',
        cpuCores: 1,
        ramTotalBytes: 0,
        gpuModel: null,
        gpuMemoryBytes: null,
        diskFreeBytes: null,
        diskTotalBytes: null,
      }),
      font: noopProvider<string | null>('font', null),
      plugin: noopProvider('plugin', []),
      operatingSystem: noopProvider('operatingSystem', {
        hostname: 'test-host',
        operatingSystem: 'darwin',
        architecture: 'arm64',
      }),
      renderProfile: noopProvider('renderProfile', []),
    },
    contractRegistry: createDefaultContractRegistry(),
    logger: overrides.logger,
  });

  return new ProjectPreparationService(
    overrides.workspaceService_,
    capabilityRegistry,
    overrides.laravelApiClient ?? ({ downloadAsset: async () => {} } as unknown as ILaravelApiClient),
    overrides.templateDownloadService ?? {
      download: async () => ({
        projectFilePath: '/tmp/does-not-matter.aep',
        assetHash: 'x',
        usedCache: false,
      }),
    },
    overrides.dependencyPackageService ?? {
      ensureInstalled: async (): Promise<DependencyInstallationReport> => ({
        renderTemplateUuid: 'x',
        packageVersion: 1,
        usedCache: false,
        fonts: { installed: [], skipped: [] },
        presets: { installed: [], skipped: [] },
        scripts: { prepared: [], skipped: [], scriptsDirectory: '/tmp' },
        plugins: { required: [], optional: [] },
        luts: { installed: [], skipped: [] },
        expressions: { installed: [], skipped: [] },
        assets: { installed: [], skipped: [], assetsDirectory: '/tmp' },
        cloudFonts: { opened: [], failed: [] },
        verification: {
          status: DependencyVerificationStatus.READY,
          missingFonts: [],
          missingPresets: [],
          missingScripts: [],
          missingLuts: [],
          missingExpressions: [],
          missingAssets: [],
        },
      }),
    },
    overrides.projectExtractor ?? {
      extract: async () => ({ projectFilePath: '/tmp/x.aep', extractedDir: '/tmp' }),
    },
    overrides.projectValidator ?? {
      validate: async () => ({ manifest, manifestFilePath: '/tmp/manifest.json' }),
    },
    overrides.variableFileBuilder ?? {
      build: async () => ({ variablesFilePath: '/tmp/variables.json', matchedCount: 0 }),
    },
    overrides.progressService ?? { stage: async () => {} },
    overrides.logger,
  );
}

async function checkWorkspaceCreationFailure(logger: Logger): Promise<void> {
  const realWorkspaceService = new AdobeWorkspaceService(logger);
  await realWorkspaceService.ensure();

  class FailingWorkspaceService extends AdobeWorkspaceService {
    override async createJobWorkspace(): Promise<JobWorkspacePaths> {
      throw new Error('disk full (simulated)');
    }
  }

  const service = stubPreparationDeps({
    logger,
    workspaceService_: new FailingWorkspaceService(logger),
  });

  const result = await service.prepare(buildInput());
  const firstError = result.errors[0] ?? '';
  record(
    'Workspace oluşturma hatası EXECUTION_WORKSPACE_FAILED ile sınıflandırılıyor',
    result.status === PreparedProjectStatus.FAILED &&
      firstError.indexOf(ErrorCode.EXECUTION_WORKSPACE_FAILED) !== -1,
    firstError,
  );
}

async function checkDependencyDownloadFailure(logger: Logger): Promise<void> {
  const workspaceService = new AdobeWorkspaceService(logger);
  await workspaceService.ensure();

  const service = stubPreparationDeps({
    logger,
    workspaceService_: workspaceService,
    dependencyPackageService: {
      ensureInstalled: async () => {
        throw new Error('network error (simulated)');
      },
    },
  });

  const result = await service.prepare(buildInput());
  const firstError = result.errors[0] ?? '';
  record(
    'Bağımlılık indirme hatası DEPENDENCY_DOWNLOAD_FAILED ile sınıflandırılıyor',
    result.status === PreparedProjectStatus.FAILED &&
      firstError.indexOf(ErrorCode.DEPENDENCY_DOWNLOAD_FAILED) !== -1,
    firstError,
  );
}

async function checkDependencyValidationFailure(logger: Logger): Promise<void> {
  const workspaceService = new AdobeWorkspaceService(logger);
  await workspaceService.ensure();

  const service = stubPreparationDeps({
    logger,
    workspaceService_: workspaceService,
    dependencyPackageService: {
      ensureInstalled: async (): Promise<DependencyInstallationReport> => ({
        renderTemplateUuid: 'x',
        packageVersion: 1,
        usedCache: false,
        fonts: { installed: [], skipped: [] },
        presets: { installed: [], skipped: [] },
        scripts: { prepared: [], skipped: [], scriptsDirectory: '/tmp' },
        plugins: { required: [], optional: [] },
        luts: { installed: [], skipped: [] },
        expressions: { installed: [], skipped: [] },
        assets: { installed: [], skipped: [], assetsDirectory: '/tmp' },
        cloudFonts: { opened: [], failed: [] },
        verification: {
          status: DependencyVerificationStatus.MISSING_DEPENDENCIES,
          missingFonts: ['Montserrat-Bold'],
          missingPresets: [],
          missingScripts: [],
          missingLuts: [],
          missingExpressions: [],
          missingAssets: [],
        },
      }),
    },
  });

  const result = await service.prepare(buildInput());
  const firstError = result.errors[0] ?? '';
  record(
    'Eksik bağımlılık DEPENDENCY_VALIDATION_FAILED ile sınıflandırılıyor (Adobe hiç açılmıyor)',
    result.status === PreparedProjectStatus.FAILED &&
      firstError.indexOf(ErrorCode.DEPENDENCY_VALIDATION_FAILED) !== -1,
    firstError,
  );
}

async function checkProgressStageOrder(logger: Logger): Promise<void> {
  const workspaceService = new AdobeWorkspaceService(logger);
  await workspaceService.ensure();

  const observedStages: string[] = [];
  const spyProgressService: IProgressService = {
    stage: async (_jobUuid, stageName) => {
      observedStages.push(stageName);
    },
  };

  const service = stubPreparationDeps({
    logger,
    workspaceService_: workspaceService,
    progressService: spyProgressService,
  });

  const result = await service.prepare(buildInput());

  const expectedOrder = [
    ExecutionStageName.PREPARING_WORKSPACE,
    ExecutionStageName.DOWNLOADING_PROJECT,
    ExecutionStageName.DOWNLOADING_DEPENDENCIES,
    ExecutionStageName.VALIDATING_DEPENDENCIES,
  ];
  const matches = expectedOrder.every((stage, index) => observedStages[index] === stage);

  record(
    'Granular execution-state ilerlemesi doğru sırayla raporlanıyor',
    result.status === PreparedProjectStatus.READY && matches,
    observedStages.join(' → '),
  );
}

function buildInput(): ProjectPreparationInput {
  return {
    renderJob: buildRenderJob(),
    engine: 'after-effects',
    capabilityReport: buildCapabilityReport(),
    localTemplateAssetFilePath: '/tmp/does-not-matter.aep',
    expectedProjectAssetHash: null,
    templateManifestSource: {
      engine: 'after-effects',
      renderComposition: null,
      requiresAlpha: false,
      renderDurationSeconds: null,
      variables: [],
    },
    localDependencyPackageZipPath: '/tmp/does-not-matter.zip',
    dependencyPackageVersion: 1,
    variableAssets: {},
  };
}

// ---- 5. RENDER_CONFIGURATION_INVALID reclassification ----

async function checkRenderConfigurationInvalid(logger: Logger): Promise<void> {
  const throwingJsxRuntime: IJsxRuntimeService = {
    runJsx: async () => {
      throw new Error('RENDER_COMPOSITION_NOT_FOUND:Final Comp');
    },
  };
  const stubBridge = {} as IAdobeBridge;

  const engine = new AfterEffectsRenderEngine(stubBridge, throwingJsxRuntime, logger);

  try {
    await engine.enqueue('/tmp/x.aep', '/tmp/out.mp4', null, 'Final Comp', null);
    record('Bulunamayan composition RENDER_CONFIGURATION_INVALID ile durduruluyor', false);
  } catch (error) {
    record(
      'Bulunamayan composition RENDER_CONFIGURATION_INVALID ile durduruluyor',
      error instanceof RenderConfigurationError &&
        error.code === ErrorCode.RENDER_CONFIGURATION_INVALID,
      (error as Error).message,
    );
  }

  // Sağlamlık kontrolü: alakasız bir JSX hatası hâlâ eskisi gibi
  // RenderQueueError/RENDER_QUEUE_FAILED olarak sınıflandırılmalı -
  // reclassification'ın aşırı geniş eşleşmediğini kanıtlar.
  const unrelatedFailureJsxRuntime: IJsxRuntimeService = {
    runJsx: async () => {
      throw new Error('some unrelated AE scripting error');
    },
  };
  const engine2 = new AfterEffectsRenderEngine(stubBridge, unrelatedFailureJsxRuntime, logger);
  try {
    await engine2.enqueue('/tmp/x.aep', '/tmp/out.mp4', null, null, null);
    record('Alakasız queue hatası hâlâ RENDER_QUEUE_FAILED olarak kalıyor', false);
  } catch (error) {
    record(
      'Alakasız queue hatası hâlâ RENDER_QUEUE_FAILED olarak kalıyor',
      error instanceof RenderQueueError && !(error instanceof RenderConfigurationError),
      (error as Error).message,
    );
  }
}

// ---- 6. ffprobe metadata collection ----

async function checkFfprobeMetadata(logger: Logger): Promise<void> {
  try {
    await execFileAsync('ffprobe', ['-version']);
  } catch {
    logger.warn(
      'ffprobe bu makinede kurulu değil - Faz 3A metadata kontrolü atlanıyor (production node\'unda ffprobe kurulu olmalı)',
    );
    record('ffprobe metadata toplama', true, 'ATLANDI - ffprobe bu makinede yok');
    return;
  }

  const workspaceService = new AdobeWorkspaceService(logger);
  const nodePaths = await workspaceService.ensure();
  const testVideoPath = resolve(nodePaths.temp, `phase3a-ffprobe-${randomUUID()}.mp4`);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=64x64:rate=10',
      '-pix_fmt',
      'yuv420p',
      testVideoPath,
    ]);
  } catch (error) {
    logger.warn('ffmpeg ile test video üretilemedi, ffprobe kontrolü atlanıyor', {
      error: (error as Error).message,
    });
    record('ffprobe metadata toplama', true, 'ATLANDI - test video üretilemedi');
    return;
  }

  try {
    const metadata = await collectOutputMetadata(testVideoPath);
    const plausible =
      metadata.durationSeconds > 0 &&
      metadata.width === 64 &&
      metadata.height === 64 &&
      metadata.videoCodec !== null;
    record('ffprobe metadata toplama (gerçek video dosyası)', plausible, JSON.stringify(metadata));
  } catch (error) {
    record('ffprobe metadata toplama (gerçek video dosyası)', false, (error as Error).message);
  } finally {
    await rm(testVideoPath, { force: true });
  }
}

async function run(): Promise<void> {
  const nodeIdentity = new NodeIdentityService();
  nodeIdentity.setNodeUuid(randomUUID());
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Faz 3A doğrulama senaryosu başlıyor');

  await checkChecksumVerification(logger);
  await checkWorkspaceCreationFailure(logger);
  await checkDependencyDownloadFailure(logger);
  await checkDependencyValidationFailure(logger);
  await checkProgressStageOrder(logger);
  await checkRenderConfigurationInvalid(logger);
  await checkFfprobeMetadata(logger);

  console.log('\n=== Faz 3A Doğrulama Sonuçları ===');
  let allPassed = true;
  for (const result of results) {
    const marker = result.passed ? 'OK  ' : 'FAIL';
    console.log(`[${marker}] ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
    if (!result.passed) {
      allPassed = false;
    }
  }

  process.exitCode = allPassed ? 0 : 1;
}

run().catch((error: unknown) => {
  console.error('[FATAL] Faz 3A doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
