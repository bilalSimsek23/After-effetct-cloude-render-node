/**
 * Standalone verification entry point for Phase 2 — proves Render Node can
 * discover, launch, and manage After Effects + Media Encoder, without
 * touching the main register/heartbeat/poll lifecycle in main.ts.
 *
 * Deliberately not folded into main.ts: launching two full Adobe apps on
 * every ordinary agent start would be slow and disruptive, and nothing in
 * JobManager uses AdobeRuntimeService yet (that wiring lands with the
 * Scanner/Render phases). Run via `npm run check:adobe`.
 *
 * node_uuid will show as "unregistered" in the logs below — this script
 * intentionally does not call register() itself, to avoid creating a
 * second, confusing registration for the same physical node.
 */
import { randomUUID } from 'node:crypto';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { ConfigLoader } from './config/config-loader.js';
import { ApiClient } from './api/api-client.js';
import { AppleScriptRunner } from './adobe/bridge/applescript-runner.js';
import { ProcessManager } from './adobe/bridge/process-manager.js';
import { AdobeBridge } from './adobe/bridge/adobe-bridge.js';
import { AfterEffectsEngine } from './adobe/engines/after-effects.engine.js';
import { AfterEffectsRenderEngine } from './adobe/engines/after-effects-render.engine.js';
import { JsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { VariableResolver } from './jsx/variable-resolver.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import { AdobeEnvironmentService } from './adobe/runtime/adobe-environment.service.js';
import { AdobeRuntimeService } from './adobe/runtime/adobe-runtime.service.js';
import { RenderProfileRegistry } from './adobe/models/render-profile.registry.js';
import { SystemReadyStatus } from './adobe/models/environment-check.types.js';
import type { Logger } from './types/log.types.js';

async function run(): Promise<void> {
  const config = new ConfigLoader().load();

  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Adobe Runtime doğrulama senaryosu başlıyor');

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

  // Render Profile scaffolding — not used yet, just proven constructible.
  const renderProfiles = new RenderProfileRegistry(config.renderProfiles);
  logger.debug('Render profilleri hazır', { profiles: renderProfiles.list() });

  const result = await runtime.initialize();

  if (result.status === SystemReadyStatus.READY) {
    // Prove the AdobeSession / Job Workspace machinery (pre-Phase 3
    // refactor) without touching any real project: a session is opened
    // for a throwaway job_uuid, its isolated workspace paths are logged,
    // then it's closed again. No render logic runs here yet.
    const demoJobUuid = randomUUID();
    const session = await runtime.createSession(demoJobUuid);
    logger.info('AdobeSession doğrulaması: workspace hazır', {
      jobUuid: demoJobUuid,
      workspace: session.getWorkspace(),
    });
    await runtime.closeSession(demoJobUuid);

    logger.info('Senaryo başarılı, Adobe Runtime kapatılıyor');
    await runtime.shutdown();
    process.exitCode = 0;
  } else {
    logger.error('Senaryo NOT_READY ile sonuçlandı', {
      status: result.status,
      errors: result.errors,
    });
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Adobe Runtime doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
