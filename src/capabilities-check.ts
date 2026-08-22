/**
 * Standalone verification for the Capability Registry — builds a real
 * CapabilityReportContract from real providers (actual CPU/RAM, actual
 * Adobe install detection, the existing RenderProfileRegistry), then
 * exercises compare()/supports()/findBestNode(). Run via
 * `npm run check:capabilities`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { AppleScriptRunner } from './adobe/bridge/applescript-runner.js';
import { ProcessManager } from './adobe/bridge/process-manager.js';
import { AdobeBridge } from './adobe/bridge/adobe-bridge.js';
import { AfterEffectsEngine } from './adobe/engines/after-effects.engine.js';
import {
  AfterEffectsRenderEngine,
  RENDER_ENGINE_MODE,
} from './adobe/engines/after-effects-render.engine.js';
import { JsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { VariableResolver } from './jsx/variable-resolver.js';
import { RenderProfileRegistry } from './adobe/models/render-profile.registry.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import { createDefaultContractRegistry } from './contracts/registry/default-contract-registry.js';
import { RenderProfileCode } from './contracts/render-profile.contract.js';
import { AdobeCapabilityProvider } from './capabilities/providers/adobe-capability.provider.js';
import { HardwareCapabilityProvider } from './capabilities/providers/hardware-capability.provider.js';
import { FontCapabilityProvider } from './capabilities/providers/font-capability.provider.js';
import { PluginCapabilityProvider } from './capabilities/providers/plugin-capability.provider.js';
import { RenderProfileCapabilityProvider } from './capabilities/providers/render-profile-capability.provider.js';
import { OperatingSystemCapabilityProvider } from './capabilities/providers/operating-system-capability.provider.js';
import { AdobeRuntimeCapabilityProvider } from './capabilities/providers/adobe-runtime-capability.provider.js';
import { CapabilityRegistry } from './capabilities/capability-registry.js';
import type { CapabilityReportContract } from './contracts/capability-report.contract.js';
import type { Logger } from './types/log.types.js';

async function run(): Promise<void> {
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Capability Registry doğrulama senaryosu başlıyor');

  const workspaceService = new AdobeWorkspaceService(logger);
  const nodePaths = await workspaceService.ensure();

  // A throwaway, deterministic fake cache file — never touches the real
  // dependency package cache that a real Render Node run would produce.
  const testCacheFilePath = resolve(nodePaths.temp, 'capability-check-font-cache.json');
  await mkdir(resolve(testCacheFilePath, '..'), { recursive: true });
  await writeFile(testCacheFilePath, JSON.stringify({ [randomUUID()]: 1 }), 'utf-8');

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
  const renderProfileRegistry = new RenderProfileRegistry();

  const contractRegistry = createDefaultContractRegistry();

  const capabilityRegistry = new CapabilityRegistry({
    nodeUuid: randomUUID(),
    nodeName: 'Mac Mini M4 #1',
    supportedEngines: ['after-effects'],
    supportedFormats: [],
    getPerformance: () => ({ maxConcurrentJobs: 1, currentRunningJobs: 0, maxQueueLength: 5 }),
    providers: {
      adobe: new AdobeCapabilityProvider(afterEffectsEngine, renderEngine),
      hardware: new HardwareCapabilityProvider(logger),
      font: new FontCapabilityProvider(testCacheFilePath, logger),
      plugin: new PluginCapabilityProvider(logger),
      renderProfile: new RenderProfileCapabilityProvider(renderProfileRegistry),
      operatingSystem: new OperatingSystemCapabilityProvider(),
    },
    runtimeCapabilityProvider: new AdobeRuntimeCapabilityProvider(
      jsxRuntime,
      resolve(nodePaths.temp, 'capability-check-detect-capabilities-report.json'),
      RENDER_ENGINE_MODE,
      logger,
    ),
    contractRegistry,
    logger,
  });

  let allPassed = true;

  const firstReport = await capabilityRegistry.register();

  const runtimeCapabilities = capabilityRegistry.getRuntimeCapabilities();
  logger.info('Adobe Runtime Capabilities (gerçek prob)', { ...runtimeCapabilities });
  if (!runtimeCapabilities) {
    allPassed = false;
    logger.error('FAIL: getRuntimeCapabilities() null döndü');
  } else {
    // Bu makinede Faz 8A/8B boyunca gerçek testle kesinleşen beklenen
    // değerler — bu bir varsayım değil, tekrar tekrar doğrulanmış gerçek
    // platform davranışı (bkz. docs/adobe-platform-constraints.md).
    if (runtimeCapabilities.supportsJSON) {
      allPassed = false;
      logger.error('FAIL: supportsJSON true döndü (bu AE sürümünde JSON global olmamalıydı)');
    }
    if (!runtimeCapabilities.supportsFontsApi) {
      allPassed = false;
      logger.error('FAIL: supportsFontsApi false döndü (app.fonts gerçek ve mevcut olmalıydı)');
    }
    if (!runtimeCapabilities.supportsRenderQueue) {
      allPassed = false;
      logger.error('FAIL: supportsRenderQueue false döndü (renderAsync mevcut olmalıydı)');
    }
    if (!runtimeCapabilities.supportsRenderQueueStatusEnum) {
      allPassed = false;
      logger.error(
        'FAIL: supportsRenderQueueStatusEnum false döndü (RQItemStatus mevcut olmalıydı)',
      );
    }
    if (runtimeCapabilities.installedOutputModuleTemplates.length === 0) {
      allPassed = false;
      logger.error('FAIL: installedOutputModuleTemplates boş döndü');
    }
    if (runtimeCapabilities.probeError) {
      allPassed = false;
      logger.error('FAIL: probe bir hata bildirdi', { probeError: runtimeCapabilities.probeError });
    }
  }
  logger.info('İlk Capability Report', {
    hostname: firstReport.hostname,
    supportedEngines: firstReport.supportedEngines,
    supportedRenderProfiles: firstReport.supportedRenderProfiles,
    hardware: firstReport.hardware,
    fontPackageVersion: firstReport.fontPackageVersion,
  });

  const secondReport = await capabilityRegistry.update();
  const comparison = capabilityRegistry.compare(firstReport, secondReport);
  logger.info('İkinci toplama karşılaştırması (değişiklik olmamalı)', { ...comparison });
  if (comparison.changed) {
    allPassed = false;
    logger.error('FAIL: aynı sistem durumu için değişiklik bildirildi', { ...comparison });
  }

  const cached = capabilityRegistry.getCapabilities();
  if (!cached) {
    allPassed = false;
    logger.error('FAIL: getCapabilities() null döndü');
  }

  const supportedRequirement = capabilityRegistry.supports(secondReport, {
    engine: 'after-effects',
    renderProfile: RenderProfileCode.PREVIEW,
  });
  const unsupportedRequirement = capabilityRegistry.supports(secondReport, {
    engine: 'premiere-pro',
    renderProfile: RenderProfileCode.PREVIEW,
  });
  logger.info('supports() sonuçları', { supportedRequirement, unsupportedRequirement });
  if (!supportedRequirement || unsupportedRequirement) {
    allPassed = false;
    logger.error('FAIL: supports() beklenmeyen sonuç döndürdü');
  }

  // findBestNode(): two synthetic reports with genuinely different load
  // ratios (both still eligible per supports(), i.e. runningJobs < max).
  const busyReport: CapabilityReportContract = {
    ...secondReport,
    nodeUuid: randomUUID(),
    performance: { ...secondReport.performance, currentRunningJobs: 3, maxConcurrentJobs: 4 },
  };
  const idleReport: CapabilityReportContract = {
    ...secondReport,
    nodeUuid: randomUUID(),
    performance: { ...secondReport.performance, currentRunningJobs: 0, maxConcurrentJobs: 4 },
  };
  const best = capabilityRegistry.findBestNode([busyReport, idleReport], {
    engine: 'after-effects',
    renderProfile: RenderProfileCode.PREVIEW,
  });
  logger.info('findBestNode() sonucu', {
    bestNodeUuid: best?.nodeUuid,
    idleNodeUuid: idleReport.nodeUuid,
  });
  if (best?.nodeUuid !== idleReport.nodeUuid) {
    allPassed = false;
    logger.error('FAIL: findBestNode() en boş node’u seçmedi');
  }

  await rm(testCacheFilePath, { force: true });

  if (allPassed) {
    logger.info('Senaryo başarılı: register/update/compare/supports/findBestNode hepsi doğrulandı');
    process.exitCode = 0;
  } else {
    logger.error('Senaryo başarısız');
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Capability Registry doğrulama senaryosu başarısız:', error);
  process.exitCode = 1;
});
