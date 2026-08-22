import { resolve } from 'node:path';
import { ConfigLoader, ConfigLoadError } from './config/config-loader.js';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { HealthService } from './services/health.service.js';
import { RetryPolicyService } from './services/retry-policy.service.js';
import { AuthService } from './api/auth.service.js';
import { LaravelApiClient } from './api/laravel-api.client.js';
import { AppleScriptRunner } from './adobe/bridge/applescript-runner.js';
import { ProcessManager } from './adobe/bridge/process-manager.js';
import { AdobeBridge } from './adobe/bridge/adobe-bridge.js';
import { JsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { VariableResolver } from './jsx/variable-resolver.js';
import { AfterEffectsEngine } from './adobe/engines/after-effects.engine.js';
import {
  AfterEffectsRenderEngine,
  RENDER_ENGINE_MODE,
} from './adobe/engines/after-effects-render.engine.js';
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
import { AdobeRuntimeCapabilityProvider } from './capabilities/providers/adobe-runtime-capability.provider.js';
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
import { UploadService } from './services/upload.service.js';
import { NodeRegistrationService } from './orchestrator/node-registration.service.js';
import { HeartbeatLoop } from './orchestrator/heartbeat-loop.js';
import { CapabilityLoop } from './orchestrator/capability-loop.js';
import { ProgressForwarder } from './orchestrator/progress-forwarder.js';
import { ResultForwarder } from './orchestrator/result-forwarder.js';
import { JobProcessor } from './orchestrator/job-processor.js';
import { PushServer } from './orchestrator/push-server.js';
import { CloudflareTunnelService } from './orchestrator/cloudflare-tunnel.service.js';
import { NodeRunner } from './orchestrator/node-runner.js';
import type { Logger } from './types/log.types.js';

async function bootstrap(): Promise<void> {
  const config = new ConfigLoader().load();

  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);
  registerGlobalErrorHandlers(logger);

  // This node's identity is provisioned out of band by an admin running
  // `php artisan cloud-render:register-render-node` on Laravel (see
  // AuthService's docblock) and lives in config.nodeUuid - never generated
  // locally, since Laravel must already know this UUID before any request
  // signed with it will verify.
  nodeIdentity.setNodeUuid(config.nodeUuid);

  logger.info('Render Node başlatılıyor (Production Orchestrator)', {
    nodeName: config.nodeName,
    server: config.server,
    engine: config.engine,
  });

  // ---- Auth + Laravel API (real HTTP, no mock) ----
  const retryPolicy = new RetryPolicyService(logger);
  const authService = new AuthService(config);
  const laravelApiClient = new LaravelApiClient(
    config,
    authService,
    nodeIdentity,
    retryPolicy,
    logger,
  );

  // ---- Adobe Runtime (Phase 2/3, untouched) ----
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

  // ---- Capability Registry (Phase 3.5, untouched) ----
  // getPerformance() needs JobProcessor's live running-job count, but
  // JobProcessor's own constructor needs CapabilityRegistry — a genuine
  // circular runtime dependency. Broken via a mutable getter reference
  // (explicitly typed, so it can be declared before JobProcessor exists and
  // reassigned once it does) rather than a circular reference between the
  // two objects themselves.
  let getRunningJobCount: () => number = () => 0;

  const dependencyCacheFilePath = resolve(nodePaths.cache, 'dependency-cache.json');
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
    runtimeCapabilityProvider: new AdobeRuntimeCapabilityProvider(
      jsxRuntime,
      resolve(nodePaths.temp, 'detect-capabilities-report.json'),
      RENDER_ENGINE_MODE,
      logger,
    ),
    contractRegistry,
    logger,
  });

  // ---- Dependency Package (Phase 3, untouched) — install targets are
  // scoped to this node's own workspace, never the real OS-wide Fonts /
  // Media Encoder presets folders, to avoid side effects on the host.
  const dependencyPackageService = new DependencyPackageService(
    resolve(nodePaths.cache, 'dependency-packages'),
    new ZipExtractor(logger),
    new DependencyManifestReader(),
    new FontInstallerService(resolve(nodePaths.cache, 'installed-fonts'), logger),
    new PresetInstallerService(resolve(nodePaths.cache, 'installed-presets'), logger),
    new ScriptPreparerService(logger),
    new LutInstallerService(resolve(nodePaths.cache, 'installed-luts'), logger),
    new ExpressionInstallerService(resolve(nodePaths.cache, 'installed-expressions'), logger),
    new DependencyAssetInstallerService(logger),
    new PluginReporterService(logger),
    new DependencyVerificationService(logger),
    new DependencyCacheService(dependencyCacheFilePath, logger),
    new CloudFontActivatorService(processManager, logger),
    logger,
  );

  // ---- Production Orchestrator (Phase 7) - progressForwarder built early
  // (moved up from its original spot below) since Project Preparation
  // (Faz 3A) now reports its own granular sub-stages through it too.
  const progressForwarder = new ProgressForwarder(laravelApiClient, contractRegistry, logger);
  const resultForwarder = new ResultForwarder(laravelApiClient, logger);

  // ---- Project Preparation (Phase 4, extended in Faz 3A with structured
  // per-step error codes + progress reporting - orchestration order unchanged) ----
  const templateDownloadService = new TemplateDownloadService(
    new TemplateCacheService(resolve(nodePaths.cache, 'template-cache.json'), logger),
    logger,
  );
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

  // ---- Execution Pipeline (Phase 5, untouched) ----
  const uploadService = new UploadService(config, authService, logger);
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

  const cloudflareTunnel = new CloudflareTunnelService(config, logger);
  const pushServer = new PushServer(config, jobProcessor, logger);

  const healthService = new HealthService(
    adobeRuntimeService,
    afterEffectsEngine,
    renderEngine,
    workspaceService,
    new HardwareCapabilityProvider(logger),
    new FontCapabilityProvider(dependencyCacheFilePath, logger),
    logger,
  );

  const nodeRunner = new NodeRunner(
    nodeRegistrationService,
    heartbeatLoop,
    capabilityLoop,
    cloudflareTunnel,
    pushServer,
    healthService,
    adobeRuntimeService,
    laravelApiClient,
    logger,
  );

  registerShutdownHandlers(logger, nodeRunner);

  try {
    await nodeRunner.start();
  } catch (error) {
    logger.error('Render Node başlatılamadı', { error: (error as Error).message });
    process.exit(1);
  }
}

function registerGlobalErrorHandlers(logger: Logger): void {
  process.on('uncaughtException', (error) => {
    logger.error('Yakalanmamış hata (uncaughtException)', {
      error: error.message,
      stack: error.stack,
    });
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Yakalanmamış promise reddi (unhandledRejection)', {
      error: error.message,
      stack: error.stack,
    });
  });
}

function registerShutdownHandlers(logger: Logger, nodeRunner: NodeRunner): void {
  const shutdown = (signal: string): void => {
    void nodeRunner
      .shutdown(signal)
      .catch((error: unknown) => {
        logger.error('Kapatma sırasında hata oluştu', { error: (error as Error).message });
      })
      .finally(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  if (error instanceof ConfigLoadError) {
    console.error(`[FATAL] ${error.message}`);
  } else {
    console.error('[FATAL] Render Node başlatılamadı:', error);
  }
  process.exit(1);
});
