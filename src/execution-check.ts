/**
 * Standalone verification for the Phase 5 Execution Pipeline — runs the
 * full Load → ApplyVariables → Save → QueueRender → Wait → CollectOutput →
 * Upload → Cleanup chain against a REAL, running After Effects (same
 * precedent as adobe-check.ts: this script needs real AE/ME installed).
 *
 * A real, valid .aep is required for LoadProjectStage to genuinely open
 * something — since Phase 4's own PreparedProject fixtures use synthetic
 * placeholder bytes (not a real AE project), this script has AE itself
 * create and save a throwaway empty project first, then feeds that real
 * file into the pipeline as PreparedProject.projectFilePath. This script
 * builds its own PreparedProject directly (not via ProjectPreparationService)
 * since Phase 5 exercises execution, not preparation — already covered by
 * `npm run check:preparation`.
 *
 * Run via `npm run check:execution`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { ConfigLoader } from './config/config-loader.js';
import { ApiClient } from './api/api-client.js';
import { AppleScriptRunner } from './adobe/bridge/applescript-runner.js';
import { ProcessManager } from './adobe/bridge/process-manager.js';
import { AdobeBridge } from './adobe/bridge/adobe-bridge.js';
import { AfterEffectsEngine } from './adobe/engines/after-effects.engine.js';
import { AfterEffectsRenderEngine } from './adobe/engines/after-effects-render.engine.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import { AdobeEnvironmentService } from './adobe/runtime/adobe-environment.service.js';
import { AdobeRuntimeService } from './adobe/runtime/adobe-runtime.service.js';
import { RenderProfileRegistry } from './adobe/models/render-profile.registry.js';
import { RenderProfileCode } from './adobe/models/render-profile.types.js';
import { SystemReadyStatus } from './adobe/models/environment-check.types.js';
import { AdobeAppId } from './adobe/models/adobe-app-id.js';
import { JsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { VariableResolver } from './jsx/variable-resolver.js';
import { JsxScriptName } from './jsx/jsx-script-name.js';
import { createDefaultContractRegistry } from './contracts/registry/default-contract-registry.js';
import {
  createRenderJobContract,
  RenderJobPriority,
  RenderJobRenderType,
} from './contracts/render-job.contract.js';
import { createManifestContract } from './contracts/manifest.contract.js';
import { createTemplateVariableContract } from './contracts/template-variable.contract.js';
import { PreparedProjectStatus } from './preparation/prepared-project.types.js';
import type { PreparedProject } from './preparation/prepared-project.types.js';
import { mapJobWorkspaceToContract } from './preparation/workspace-contract.mapper.js';
import { ProgressService } from './services/progress.service.js';
import { RetryPolicyService } from './services/retry-policy.service.js';
import type { IUploadService } from './services/upload.service.js';
import { ExecutionContextBuilder } from './execution/execution-context-builder.js';
import { ExecutionPipeline } from './execution/execution-pipeline.js';
import { ExecutionResultStatus } from './execution/execution-result.js';
import { LoadProjectStage } from './execution/stages/load-project.stage.js';
import { ApplyVariablesStage } from './execution/stages/apply-variables.stage.js';
import { SaveProjectStage } from './execution/stages/save-project.stage.js';
import { QueueRenderStage } from './execution/stages/queue-render.stage.js';
import { WaitRenderStage } from './execution/stages/wait-render.stage.js';
import { CollectOutputStage } from './execution/stages/collect-output.stage.js';
import { UploadOutputStage } from './execution/stages/upload-output.stage.js';
import { CleanupStage } from './execution/stages/cleanup.stage.js';
import type { Logger } from './types/log.types.js';

async function run(): Promise<void> {
  const config = new ConfigLoader().load();
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Execution Pipeline doğrulama senaryosu başlıyor');

  const apiClient = new ApiClient(config, logger, nodeIdentity);
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
  const environmentService = new AdobeEnvironmentService(
    afterEffectsEngine,
    renderEngine,
    workspaceService,
    logger,
  );
  const runtime = new AdobeRuntimeService(
    afterEffectsEngine,
    renderEngine,
    environmentService,
    workspaceService,
    apiClient,
    logger,
  );

  const contractRegistry = createDefaultContractRegistry();
  const renderProfileRegistry = new RenderProfileRegistry(config.renderProfiles);
  const renderProfile = renderProfileRegistry.find(RenderProfileCode.PREVIEW);
  if (!renderProfile) {
    throw new Error('PREVIEW render profili bulunamadı.');
  }

  const environmentResult = await runtime.initialize();
  if (environmentResult.status !== SystemReadyStatus.READY) {
    logger.error('Adobe Runtime NOT_READY, Execution Pipeline testi çalıştırılamıyor', {
      errors: environmentResult.errors,
    });
    process.exitCode = 1;
    return;
  }

  let allPassed = true;

  // Direct JSX Runtime verification: each real skeleton file, run via
  // #include against real After Effects, writes its own marker to a real
  // file — proving the file itself (not some other code) genuinely ran.
  // (DoScript's own return value can't be used for this — real testing
  // showed After Effects' DoScript returns a status code, not the
  // script's last expression value, unlike what a naive read of the
  // AppleScript dictionary would suggest.)
  //
  // APPLY_VARIABLES and SAVE_PROJECT dropped from this list in Faz 8A:
  // both stopped being marker-writing skeletons once they became the real
  // Variable Engine / real Save — calling them with only a bare
  // markerFilePath payload (no variablesFile/reportFile, no open project)
  // no longer no-ops into a marker write, it genuinely tries to run and
  // hangs waiting on data that isn't there. Their real behavior is
  // already exercised for real further down in this same script (the full
  // pipeline run) and in check:render.
  const markerDir = resolve(workspaceService.getPaths().temp, 'execution-check-markers');
  await mkdir(markerDir, { recursive: true });

  const expectedMarkers: Record<string, string> = {
    [JsxScriptName.OPEN_PROJECT]: 'open-project:skeleton',
    [JsxScriptName.CLOSE_PROJECT]: 'close-project:skeleton',
  };

  for (const [scriptName, expectedMarker] of Object.entries(expectedMarkers)) {
    const markerFilePath = resolve(markerDir, `${scriptName}.marker`);
    await jsxRuntime.runJsx(AdobeAppId.AFTER_EFFECTS, scriptName as JsxScriptName, {
      markerFilePath,
    });

    const actualMarker = await readFile(markerFilePath, 'utf-8').catch(() => null);
    if (actualMarker !== expectedMarker) {
      allPassed = false;
      logger.error('FAIL: JSX script marker dosyası beklenen içerikle eşleşmiyor', {
        scriptName,
        expectedMarker,
        actualMarker,
      });
    }
  }
  logger.info('JSX Runtime doğrudan doğrulama tamamlandı (marker dosyaları ile)');
  await rm(markerDir, { recursive: true, force: true });

  const jobUuid = randomUUID();
  const session = await runtime.createSession(jobUuid);
  const jobWorkspace = session.getWorkspace();

  // A real, valid .aep, created and saved by After Effects itself — the
  // pipeline's LoadProjectStage genuinely opens this file for real. A
  // real comp + named text layer is required too, since Faz 8A's real
  // PropertyResolver resolves variables by layer name + property path
  // (no working Essential Graphics read-back API exists in this AE
  // build — confirmed by real testing).
  const testProjectPath = resolve(jobWorkspace.source, 'execution-check-project.aep');
  await bridge.runJsxCode(
    AdobeAppId.AFTER_EFFECTS,
    `if (app.project) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }
     app.newProject();
     var comp = app.project.items.addComp('ExecutionCheckComp', 1920, 1080, 1, 5, 30);
     var textLayer = comp.layers.addText('placeholder');
     textLayer.name = 'TitleLayer';
     app.project.save(File(${JSON.stringify(testProjectPath)}));`,
  );

  const testVariablesPath = resolve(jobWorkspace.variables, 'variables.json');
  await writeFile(testVariablesPath, JSON.stringify({ title_text: 'Execution Check' }), 'utf-8');

  const testManifest = createManifestContract({
    schemaVersion: '1.0.0',
    scannerVersion: '1.0.0',
    engine: 'after-effects',
    variables: [
      createTemplateVariableContract({
        key: 'title_text',
        label: 'Title Text',
        type: 'text',
        defaultValue: 'Execution Check',
        sortOrder: 0,
        metadata: {
          compositionName: 'ExecutionCheckComp',
          layerName: 'TitleLayer',
          propertyPath: ['Source Text'],
        },
      }),
    ],
    metadata: {},
  });
  await writeFile(
    resolve(jobWorkspace.manifest, 'manifest.json'),
    JSON.stringify(testManifest, null, 2),
    'utf-8',
  );

  const preparedProject: PreparedProject = {
    jobUuid,
    status: PreparedProjectStatus.READY,
    projectFilePath: testProjectPath,
    variablesFilePath: testVariablesPath,
    workspace: mapJobWorkspaceToContract(jobWorkspace),
    errors: [],
  };

  const renderJob = createRenderJobContract({
    jobUuid,
    templateUuid: randomUUID(),
    projectUuid: randomUUID(),
    userUuid: randomUUID(),
    variables: { title_text: 'Execution Check' },
    priority: RenderJobPriority.NORMAL,
    renderType: RenderJobRenderType.PREVIEW,
  });

  const progressService = new ProgressService(apiClient, contractRegistry, logger);
  const retryPolicy = new RetryPolicyService(logger);
  const contextBuilder = new ExecutionContextBuilder();

  const context = contextBuilder.build({
    job: renderJob,
    preparedProject,
    adobeSession: session,
    renderProfile,
    progressService,
    retryPolicy,
    logger,
  });

  // Upload itself isn't this check's concern (see render-check.ts for real
  // upload coverage against a local test server) - a no-op stub keeps this
  // script from making a real network call.
  const uploadService: IUploadService = { upload: async () => '' };
  const pipeline = new ExecutionPipeline(
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

  const result = await pipeline.run(context);
  logger.info('Execution Pipeline sonucu', {
    status: result.status,
    jobUuid: result.jobUuid,
    durationMs: result.durationMs,
    errors: result.errors,
  });

  if (result.status !== ExecutionResultStatus.COMPLETED) {
    allPassed = false;
    logger.error('FAIL: pipeline COMPLETED ile sonuçlanmadı', { errors: result.errors });
  }

  if (!result.renderResult) {
    allPassed = false;
    logger.error('FAIL: renderResult null');
  } else {
    logger.info('RenderResultContract', { ...result.renderResult });
  }

  if (!context.state.renderQueueItemId) {
    allPassed = false;
    logger.error('FAIL: renderQueueItemId set edilmedi');
  }

  if (!session.isDisposed()) {
    allPassed = false;
    logger.error('FAIL: CleanupStage AdobeSession.dispose() çağırmadı');
  }

  // Real cleanup this script itself is responsible for (Phase 5's own
  // CleanupStage deliberately does not delete files yet, and doesn't close
  // the project in the real app either — only disposes the session).
  await afterEffectsEngine.closeProject();
  await rm(jobWorkspace.root, { recursive: true, force: true });
  await runtime.shutdown();

  if (allPassed) {
    logger.info(
      'Senaryo başarılı: Execution Pipeline uçtan uca doğrulandı (gerçek AE ile JSX Runtime, gerçek proje aç/kaydet, tüm stage sırası, Contract üretimi)',
    );
    process.exitCode = 0;
  } else {
    logger.error('Senaryo başarısız');
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Execution Pipeline doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
