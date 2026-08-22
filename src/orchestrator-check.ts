/**
 * Standalone verification for the Production Orchestrator against the
 * REAL Phase-2 Laravel contract (HMAC-signed requests, Laravel-initiated
 * push notification, per-job claim, node-auth'd asset streaming) — the
 * first genuinely real, end-to-end test of the whole platform (Contract
 * Layer → Capability Registry → Adobe Runtime → Dependency Package →
 * Project Preparation → Execution Pipeline → Production Orchestrator).
 *
 * Since pratiktools-site isn't reachable from this script, it spins up a
 * genuine local HTTP server (Node's built-in `http`, zero new
 * dependencies) implementing exactly pratiktools-site's real render-node
 * routes/api.php contract — real HMAC signature verification (the same
 * algorithm as RenderNodeAuthenticator.php), real per-job claim, real file
 * downloads — and points config.server at it. There is no Cloudflare
 * Tunnel here (a NoOpTunnelService stands in for it) - the fake server
 * pushes its notification directly to PushServer's local port, exactly as
 * it would arrive from a real tunnel, without needing a real `cloudflared`
 * process or public hostname for a same-machine test.
 *
 * A real, valid .aep (created by real After Effects, exactly like
 * execution-check.ts) is packaged into a synthetic nested template
 * archive and served for real download — same reasoning as Phase 5/6:
 * genuine test data wherever practical, synthetic only where an external
 * system (here, Laravel) isn't reachable.
 *
 * Run via `npm run check:orchestrator`.
 */
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { HealthService } from './services/health.service.js';
import { RetryPolicyService } from './services/retry-policy.service.js';
import { AuthService } from './api/auth.service.js';
import { LaravelApiClient } from './api/laravel-api.client.js';
import { AppleScriptRunner } from './adobe/bridge/applescript-runner.js';
import { ProcessManager } from './adobe/bridge/process-manager.js';
import { AdobeBridge } from './adobe/bridge/adobe-bridge.js';
import { AdobeAppId } from './adobe/models/adobe-app-id.js';
import { JsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { VariableResolver } from './jsx/variable-resolver.js';
import { AfterEffectsEngine } from './adobe/engines/after-effects.engine.js';
import { AfterEffectsRenderEngine } from './adobe/engines/after-effects-render.engine.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import { AdobeEnvironmentService } from './adobe/runtime/adobe-environment.service.js';
import { AdobeRuntimeService } from './adobe/runtime/adobe-runtime.service.js';
import { RenderProfileRegistry } from './adobe/models/render-profile.registry.js';
import { createDefaultContractRegistry } from './contracts/registry/default-contract-registry.js';
import { CapabilityRegistry } from './capabilities/capability-registry.js';
import { AdobeCapabilityProvider } from './capabilities/providers/adobe-capability.provider.js';
import { HardwareCapabilityProvider } from './capabilities/providers/hardware-capability.provider.js';
import { FontCapabilityProvider } from './capabilities/providers/font-capability.provider.js';
import { PluginCapabilityProvider } from './capabilities/providers/plugin-capability.provider.js';
import { RenderProfileCapabilityProvider } from './capabilities/providers/render-profile-capability.provider.js';
import { OperatingSystemCapabilityProvider } from './capabilities/providers/operating-system-capability.provider.js';
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
import { DependencyPackageService } from './adobe/dependency/dependency-package.service.js';
import { TemplateCacheService } from './preparation/template-cache.service.js';
import { TemplateDownloadService } from './preparation/template-download.service.js';
import { ProjectExtractor } from './preparation/project-extractor.js';
import { ProjectValidator } from './preparation/project-validator.js';
import { VariableFileBuilder } from './preparation/variable-file-builder.js';
import { ProjectPreparationService } from './preparation/project-preparation.service.js';
import { ExecutionContextBuilder } from './execution/execution-context-builder.js';
import { ExecutionPipeline } from './execution/execution-pipeline.js';
import { LoadProjectStage } from './execution/stages/load-project.stage.js';
import { ApplyVariablesStage } from './execution/stages/apply-variables.stage.js';
import { SaveProjectStage } from './execution/stages/save-project.stage.js';
import { QueueRenderStage } from './execution/stages/queue-render.stage.js';
import { WaitRenderStage } from './execution/stages/wait-render.stage.js';
import { CollectOutputStage } from './execution/stages/collect-output.stage.js';
import { UploadOutputStage } from './execution/stages/upload-output.stage.js';
import { CleanupStage } from './execution/stages/cleanup.stage.js';
import type { IUploadService } from './services/upload.service.js';
import { NodeRegistrationService } from './orchestrator/node-registration.service.js';
import { HeartbeatLoop } from './orchestrator/heartbeat-loop.js';
import { CapabilityLoop } from './orchestrator/capability-loop.js';
import { ProgressForwarder } from './orchestrator/progress-forwarder.js';
import { ResultForwarder } from './orchestrator/result-forwarder.js';
import { JobProcessor } from './orchestrator/job-processor.js';
import { PushServer, PUSH_NOTIFICATION_PATH } from './orchestrator/push-server.js';
import type { ITunnelService } from './orchestrator/cloudflare-tunnel.service.js';
import { NodeRunner } from './orchestrator/node-runner.js';
import { RenderJobPriority, RenderJobRenderType } from './contracts/render-job.contract.js';
import { createManifestContract } from './contracts/manifest.contract.js';
import { createTemplateVariableContract } from './contracts/template-variable.contract.js';
import type { RenderNodeConfig } from './types/config.types.js';
import type { Logger } from './types/log.types.js';

const TEST_PORT = 41777;
const TEST_SERVER = `http://127.0.0.1:${TEST_PORT}`;
const PUSH_PORT = 41778;
const TEST_NODE_UUID = randomUUID();
const TEST_API_SECRET = 'test-api-secret';

class NoOpTunnelService implements ITunnelService {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

interface FakeLaravelState {
  jobUuid: string;
  templateUuid: string;
  jobAlreadyClaimed: boolean;
  receivedProgressStages: string[];
  completedResult: unknown | null;
  failedErrors: string[] | null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(payload);
}

/** Mirrors RenderNodeAuthenticator.php exactly: X-Node-* headers, HMAC-SHA256 over `{timestamp}|{nonce}|{rawBody}`. */
function verifyNodeAuthHeaders(req: IncomingMessage, rawBody: string): boolean {
  const nodeUuid = req.headers['x-node-uuid'];
  const timestamp = req.headers['x-node-timestamp'];
  const nonce = req.headers['x-node-nonce'];
  const signature = req.headers['x-node-signature'];

  if (
    typeof nodeUuid !== 'string' ||
    typeof timestamp !== 'string' ||
    typeof nonce !== 'string' ||
    typeof signature !== 'string' ||
    nodeUuid !== TEST_NODE_UUID
  ) {
    return false;
  }

  const expected = createHmac('sha256', TEST_API_SECRET)
    .update(`${timestamp}|${nonce}|${rawBody}`)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

/** Builds a real, valid .aep (via real After Effects) wrapped in the same nested archive shape execution-check.ts uses, plus a manifest.json — this is what the fake server's asset-download route serves. */
async function buildFakeTemplatePackage(
  bridge: AdobeBridge,
  workDir: string,
  manifest: ReturnType<typeof createManifestContract>,
): Promise<string> {
  await mkdir(workDir, { recursive: true });
  const projectPath = resolve(workDir, 'orchestrator-check-project.aep');

  // A real comp + a real, named text layer — needed since Faz 8A's real
  // PropertyResolver resolves variables by layer name + property path,
  // not by an (empirically confirmed non-existent) Essential Graphics
  // read-back API.
  await bridge.runJsxCode(
    AdobeAppId.AFTER_EFFECTS,
    `if (app.project) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }
     app.newProject();
     var comp = app.project.items.addComp('OrchestratorCheckComp', 1920, 1080, 1, 5, 30);
     var textLayer = comp.layers.addText('placeholder');
     textLayer.name = 'TitleLayer';
     app.project.save(File(${JSON.stringify(projectPath)}));`,
  );

  const innerZip = new AdmZip();
  innerZip.addLocalFile(projectPath);
  innerZip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

  const outerZip = new AdmZip();
  outerZip.addFile('project.aegraphic', innerZip.toBuffer());
  outerZip.addFile('definition.json', Buffer.from('{}'));

  const packagePath = resolve(workDir, 'template-package.zip');
  outerZip.writeZip(packagePath);

  return packagePath;
}

async function buildFakeDependencyPackage(destinationPath: string): Promise<void> {
  const zip = new AdmZip();
  zip.addFile(
    'dependencies.json',
    Buffer.from(
      JSON.stringify({
        version: 1,
        fonts: [],
        plugins: [],
        presets: [],
        scripts: [],
        luts: [],
        expressions: [],
        assets: [],
      }),
    ),
  );
  await mkdir(resolve(destinationPath, '..'), { recursive: true });
  zip.writeZip(destinationPath);
}

async function run(): Promise<void> {
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);
  logger.info('Production Orchestrator doğrulama senaryosu başlıyor');

  let allPassed = true;
  const fail = (message: string, details?: Record<string, unknown>): void => {
    allPassed = false;
    logger.error(`FAIL: ${message}`, details);
  };

  // ---- Real Adobe stack (same as execution-check.ts) ----
  const config: RenderNodeConfig = {
    server: TEST_SERVER,
    nodeUuid: TEST_NODE_UUID,
    apiSecret: TEST_API_SECRET,
    nodeName: 'Orchestrator Check Node',
    heartbeatInterval: 1,
    maxConcurrentJobs: 2,
    agentVersion: '1.0.0',
    engine: 'after-effects',
    supportedEngines: ['after-effects'],
    pushServer: { port: PUSH_PORT, tunnelToken: 'unused-in-this-check' },
  };
  nodeIdentity.setNodeUuid(config.nodeUuid);

  const appleScriptRunner = new AppleScriptRunner(logger);
  const processManager = new ProcessManager(logger);
  const bridge = new AdobeBridge(appleScriptRunner, processManager, logger);
  const jsxRuntime = new JsxRuntimeService(bridge, logger);
  const afterEffectsEngine = new AfterEffectsEngine(
    bridge,
    jsxRuntime,
    new VariableResolver(logger),
    logger,
  );
  const renderEngine = new AfterEffectsRenderEngine(bridge, jsxRuntime, logger);
  const workspaceService = new AdobeWorkspaceService(logger);
  const nodePaths = await workspaceService.ensure();
  const environmentService = new AdobeEnvironmentService(
    afterEffectsEngine,
    renderEngine,
    workspaceService,
    logger,
  );

  // ---- Build the real test fixtures BEFORE the fake server starts (it needs to serve them) ----
  const jobUuid = randomUUID();
  const templateUuid = randomUUID();
  const claimToken = randomUUID();
  const fixturesDir = resolve(nodePaths.temp, 'orchestrator-check-fixtures');
  await rm(fixturesDir, { recursive: true, force: true });

  const manifest = createManifestContract({
    schemaVersion: '1.0.0',
    scannerVersion: '1.0.0',
    engine: 'after-effects',
    variables: [
      createTemplateVariableContract({
        key: 'title_text',
        label: 'Title Text',
        type: 'text',
        defaultValue: 'Varsayılan Başlık',
        sortOrder: 0,
        metadata: {
          compositionName: 'OrchestratorCheckComp',
          layerName: 'TitleLayer',
          propertyPath: ['Source Text'],
        },
      }),
    ],
    metadata: {},
  });

  const state: FakeLaravelState = {
    jobUuid,
    templateUuid,
    jobAlreadyClaimed: false,
    receivedProgressStages: [],
    completedResult: null,
    failedErrors: null,
  };

  let templatePackagePath = '';
  let dependencyPackagePath = '';

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      logger.error('Sahte Laravel sunucusu isteği işleyemedi', { error: (error as Error).message });
      sendJson(res, 500, { error: (error as Error).message });
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', TEST_SERVER);
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const rawBody = method === 'GET' ? '' : await readBody(req);

    // Every render-node route in the real Laravel app sits behind
    // render-node.auth — verify identically here before dispatching.
    if (path.startsWith('/api/render-nodes/') && !verifyNodeAuthHeaders(req, rawBody)) {
      sendJson(res, 401, { success: false, error: 'RENDER_NODE_UNAUTHORIZED' });
      return;
    }

    if (path === '/api/render-nodes/heartbeat' && method === 'POST') {
      sendJson(res, 200, { success: true, message: 'Heartbeat recorded.' });
      return;
    }

    if (path === `/api/render-nodes/render-jobs/${jobUuid}/project-asset` && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(await readFile(templatePackagePath));
      return;
    }

    if (path === `/api/render-nodes/render-jobs/${jobUuid}/dependency-package` && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(await readFile(dependencyPackagePath));
      return;
    }

    if (path === `/api/render-nodes/render-jobs/${jobUuid}/claim` && method === 'POST') {
      const body = JSON.parse(rawBody) as { claimToken: string };
      if (body.claimToken !== claimToken) {
        sendJson(res, 403, { success: false, error: 'RENDER_JOB_INVALID_CLAIM_TOKEN' });
        return;
      }
      state.jobAlreadyClaimed = true;

      sendJson(res, 200, {
        success: true,
        message: 'RenderJob claimed.',
        job: {
          schema: 'render-job',
          version: '1.0.0',
          jobUuid,
          templateUuid,
          projectUuid: randomUUID(),
          userUuid: randomUUID(),
          renderType: RenderJobRenderType.PREVIEW,
          priority: RenderJobPriority.NORMAL,
          renderProfile: RenderJobRenderType.PREVIEW,
          variables: { title_text: 'Orkestratör Testi' },
          template: {
            engine: 'after-effects',
            renderComposition: 'OrchestratorCheckComp',
            requiresAlpha: false,
            renderDurationSeconds: 5,
            variables: [],
          },
          projectAsset: {
            checksumSha256: null,
            originalFilename: 'template-package.zip',
            downloadUrl: `${TEST_SERVER}/api/render-nodes/render-jobs/${jobUuid}/project-asset`,
          },
          projectPackage: {
            packageUuid: randomUUID(),
            version: 1,
            checksumSha256: 'test-checksum',
            downloadUrl: `${TEST_SERVER}/api/render-nodes/render-jobs/${jobUuid}/dependency-package`,
          },
          variableAssets: {},
          correlationId: null,
        },
      });
      return;
    }

    if (path === `/api/jobs/${jobUuid}/progress` && method === 'POST') {
      const body = JSON.parse(rawBody) as { currentStep: string };
      state.receivedProgressStages.push(body.currentStep);
      sendJson(res, 204, undefined);
      return;
    }

    if (path === `/api/jobs/${jobUuid}/completed` && method === 'POST') {
      state.completedResult = JSON.parse(rawBody);
      sendJson(res, 204, undefined);
      return;
    }

    if (path === `/api/jobs/${jobUuid}/failed` && method === 'POST') {
      const body = JSON.parse(rawBody) as { errors: string[] };
      state.failedErrors = body.errors;
      sendJson(res, 204, undefined);
      return;
    }

    sendJson(res, 404, { error: `bilinmeyen endpoint: ${method} ${path}` });
  }

  await new Promise<void>((resolvePromise) => server.listen(TEST_PORT, resolvePromise));
  logger.info('Sahte Laravel sunucusu başlatıldı', { server: TEST_SERVER });

  // AdobeRuntimeService.initialize() calls reportSystemStatus(), so it
  // needs a real IApiClient — build LaravelApiClient first.
  const retryPolicy = new RetryPolicyService(logger);
  const authService = new AuthService(config);
  const laravelApiClient = new LaravelApiClient(
    config,
    authService,
    nodeIdentity,
    retryPolicy,
    logger,
  );

  const adobeRuntimeService = new AdobeRuntimeService(
    afterEffectsEngine,
    renderEngine,
    environmentService,
    workspaceService,
    laravelApiClient,
    logger,
  );

  const renderProfileRegistry = new RenderProfileRegistry(config.renderProfiles);
  const contractRegistry = createDefaultContractRegistry();

  let getRunningJobCount: () => number = () => 0;
  const dependencyCacheFilePath = resolve(
    nodePaths.cache,
    'orchestrator-check-dependency-cache.json',
  );

  const capabilityRegistry = new CapabilityRegistry({
    nodeUuid: config.nodeUuid,
    nodeName: config.nodeName,
    supportedEngines: config.supportedEngines,
    supportedFormats: [],
    getPerformance: () => ({
      maxConcurrentJobs: config.maxConcurrentJobs,
      currentRunningJobs: getRunningJobCount(),
      maxQueueLength: config.maxConcurrentJobs * 4,
    }),
    providers: {
      adobe: new AdobeCapabilityProvider(afterEffectsEngine, renderEngine),
      hardware: new HardwareCapabilityProvider(logger),
      font: new FontCapabilityProvider(dependencyCacheFilePath, logger),
      plugin: new PluginCapabilityProvider(logger),
      renderProfile: new RenderProfileCapabilityProvider(renderProfileRegistry),
      operatingSystem: new OperatingSystemCapabilityProvider(),
    },
    contractRegistry,
    logger,
  });

  const dependencyPackageService = new DependencyPackageService(
    resolve(nodePaths.cache, 'orchestrator-check-dependency-packages'),
    new ZipExtractor(logger),
    new DependencyManifestReader(),
    new FontInstallerService(resolve(nodePaths.temp, 'orchestrator-check-fonts'), logger),
    new PresetInstallerService(resolve(nodePaths.temp, 'orchestrator-check-presets'), logger),
    new ScriptPreparerService(logger),
    new LutInstallerService(resolve(nodePaths.temp, 'orchestrator-check-luts'), logger),
    new ExpressionInstallerService(
      resolve(nodePaths.temp, 'orchestrator-check-expressions'),
      logger,
    ),
    new DependencyAssetInstallerService(logger),
    new PluginReporterService(logger),
    new DependencyVerificationService(logger),
    new DependencyCacheService(dependencyCacheFilePath, logger),
    new CloudFontActivatorService(processManager, logger),
    logger,
  );

  const templateDownloadService = new TemplateDownloadService(
    new TemplateCacheService(
      resolve(nodePaths.cache, 'orchestrator-check-template-cache.json'),
      logger,
    ),
    logger,
  );
  // Faz 3A: moved up from below - ProjectPreparationService now reports
  // its own granular sub-stages through the same progressForwarder.
  const progressForwarder = new ProgressForwarder(laravelApiClient, contractRegistry, logger);

  const projectPreparationService = new ProjectPreparationService(
    workspaceService,
    capabilityRegistry,
    laravelApiClient,
    templateDownloadService,
    dependencyPackageService,
    new ProjectExtractor(logger),
    new ProjectValidator(contractRegistry, logger),
    new VariableFileBuilder(logger),
    progressForwarder,
    logger,
  );

  // Upload itself isn't this check's concern (see render-check.ts for real
  // upload coverage against a local test server) - a no-op stub keeps this
  // script from making a real network call.
  const uploadService: IUploadService = { upload: async () => '' };
  const executionPipeline = new ExecutionPipeline(
    new LoadProjectStage(),
    new ApplyVariablesStage(),
    new SaveProjectStage(),
    new QueueRenderStage(renderProfileRegistry),
    new WaitRenderStage(),
    new CollectOutputStage(),
    new UploadOutputStage(uploadService),
    new CleanupStage(),
    contractRegistry,
    logger,
  );
  const executionContextBuilder = new ExecutionContextBuilder();

  const resultForwarder = new ResultForwarder(laravelApiClient, logger);

  const jobProcessor = new JobProcessor(
    laravelApiClient,
    adobeRuntimeService,
    workspaceService,
    capabilityRegistry,
    renderProfileRegistry,
    projectPreparationService,
    executionContextBuilder,
    executionPipeline,
    progressForwarder,
    retryPolicy,
    resultForwarder,
    config,
    logger,
  );
  getRunningJobCount = () => jobProcessor.getRunningJobCount();

  const heartbeatLoop = new HeartbeatLoop(
    laravelApiClient,
    nodeIdentity,
    jobProcessor,
    contractRegistry,
    config,
    logger,
  );
  const capabilityLoop = new CapabilityLoop(capabilityRegistry, logger);
  const nodeRegistrationService = new NodeRegistrationService(
    adobeRuntimeService,
    capabilityRegistry,
    config,
    logger,
  );
  const healthService = new HealthService(
    adobeRuntimeService,
    afterEffectsEngine,
    renderEngine,
    workspaceService,
    new HardwareCapabilityProvider(logger),
    new FontCapabilityProvider(dependencyCacheFilePath, logger),
    logger,
  );

  const tunnel = new NoOpTunnelService();
  const pushServer = new PushServer(config, jobProcessor, logger);

  const nodeRunner = new NodeRunner(
    nodeRegistrationService,
    heartbeatLoop,
    capabilityLoop,
    tunnel,
    pushServer,
    healthService,
    adobeRuntimeService,
    laravelApiClient,
    logger,
    3_600_000, // health check loop: effectively disabled for this short-lived test
  );

  try {
    // NodeRunner.start() runs the real Node Lifecycle: Environment Check →
    // Adobe Runtime initialize() → Capability collect() → heartbeat/
    // capability loops + push server start (identity itself is
    // pre-provisioned via config, not registered with Laravel).
    await nodeRunner.start();
    logger.info('Node hazır', { nodeUuid: config.nodeUuid });

    // Build the real template/dependency fixtures now that AE is confirmed
    // ready (NodeRunner.start() already ran the Environment Check).
    templatePackagePath = await buildFakeTemplatePackage(bridge, fixturesDir, manifest);
    dependencyPackagePath = resolve(fixturesDir, 'dependency-package.zip');
    await buildFakeDependencyPackage(dependencyPackagePath);

    // Simulate Laravel assigning this job: push a correctly-signed
    // notification directly at PushServer's local port, exactly as it
    // would arrive through a real Cloudflare Tunnel.
    const claimUrl = `${TEST_SERVER}/api/render-nodes/render-jobs/${jobUuid}/claim`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const pushSignature = createHmac('sha256', TEST_API_SECRET)
      .update(`${jobUuid}|${claimUrl}|${expiresAt}`)
      .digest('hex');

    const pushResponse = await fetch(`http://127.0.0.1:${PUSH_PORT}${PUSH_NOTIFICATION_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema: 'render-job-notification',
        version: '1.0.0',
        jobUuid,
        claimUrl,
        claimToken,
        expiresAt,
        signature: pushSignature,
      }),
    });

    if (!pushResponse.ok) {
      fail('Push bildirimi PushServer tarafından kabul edilmedi', {
        status: pushResponse.status,
      });
    }

    // Wait for the job triggered by the push to run all the way through to
    // a completed/failed report.
    const deadline = Date.now() + 30_000;
    while (!state.completedResult && !state.failedErrors && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }

    if (!state.jobAlreadyClaimed) {
      fail('İş hiç claim edilmedi (push bildirimi işlenmedi)');
    }

    if (state.failedErrors) {
      fail('İş FAILED olarak raporlandı', { errors: state.failedErrors });
    } else if (!state.completedResult) {
      fail('İş zaman aşımına uğradı (ne completed ne failed raporlandı)');
    } else {
      logger.info("İş COMPLETED olarak Laravel'e (sahte sunucuya) raporlandı", {
        result: state.completedResult,
      });
    }

    if (state.receivedProgressStages.length === 0) {
      fail("Hiç RenderProgressContract Laravel'e iletilmedi");
    } else {
      logger.info('İlerleme raporları alındı', { stages: state.receivedProgressStages });
    }

    // Real project.aep this script created directly (outside the fixture
    // package) must be cleaned up from the real AE session.
    await bridge.runJsxCode(
      AdobeAppId.AFTER_EFFECTS,
      'if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);',
    );
  } catch (error) {
    fail('Senaryo çalıştırılırken beklenmeyen bir hata oluştu', {
      error: (error as Error).message,
    });
  } finally {
    await nodeRunner.shutdown('TEST');
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    await rm(fixturesDir, { recursive: true, force: true });
  }

  if (allPassed) {
    logger.info(
      'Senaryo başarılı: Production Orchestrator gerçek Laravel Phase-2 kontratına karşı uçtan uca doğrulandı (HMAC auth, push notification, capability, heartbeat, job claim, indirme, preparation, execution, progress/result forwarding, shutdown)',
    );
    process.exitCode = 0;
  } else {
    logger.error('Senaryo başarısız');
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Production Orchestrator doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
