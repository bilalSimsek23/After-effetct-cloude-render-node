/**
 * Manuel, gerçek-proje Variable Engine testi (Faz 8C) — render-check.ts'in
 * aksine burada proje/manifest SENTETİK olarak üretilmiyor: kullanıcının
 * kendi gerçek `.aep` dosyası + kendi gerçek `manifest.json`'ı +
 * `variables.json`'ı CLI argümanlarından okunuyor. Sadece Variable Engine
 * (VariableResolver → PropertyResolver → VariableHandlers) test edilir —
 * render/upload YOK, saniyeler içinde biter.
 *
 * `manifest.json`, bu projenin `ManifestContract` şemasında olmalı
 * (`key`/`label`/`type`/`metadata.compositionName`/`metadata.layerName`/
 * `metadata.propertyPath`/`metadata.propertyMatchName` — bkz.
 * docs/scanner-manifest-metadata-contract.md). Gerçek prodüksiyon
 * Scanner'ının ham çıktısı (`id`/`displayName`/`normalizedType`/`ae.*`)
 * BUNUNLA AYNI ŞEMA DEĞİL — doğrudan verilirse `PropertyAddressResolution
 * Error`/`UnsupportedVariableTypeError` ile reddedilir.
 *
 * Gerçek proje dosyası HİÇBİR ZAMAN kaydedilmez: proje `CloseOptions.
 * DO_NOT_SAVE_CHANGES` ile kapatılır (başarı/başarısızlık fark etmeksizin),
 * bu yüzden diskteki gerçek `.aep` bu testten sonra da bozulmadan kalır.
 *
 * Kullanım:
 *   npm run check:variables -- --project "/gerçek/proje.aep" \
 *     --manifest "/gerçek/manifest.json" --variables "/gerçek/variables.json" [--dry-run]
 */
import { randomUUID } from 'node:crypto';
import { copyFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { ConfigLoader } from './config/config-loader.js';
import { ApiClient } from './api/api-client.js';
import { createAdobeBridgeBundle } from './adobe/bridge/create-adobe-bridge.js';
import { AfterEffectsEngine } from './adobe/engines/after-effects.engine.js';
import { AfterEffectsRenderEngine } from './adobe/engines/after-effects-render.engine.js';
import { AdobeWorkspaceService } from './adobe/runtime/adobe-workspace.service.js';
import { AdobeEnvironmentService } from './adobe/runtime/adobe-environment.service.js';
import { AdobeRuntimeService } from './adobe/runtime/adobe-runtime.service.js';
import { SystemReadyStatus } from './adobe/models/environment-check.types.js';
import { JsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { VariableResolver } from './jsx/variable-resolver.js';
import { VariableApplicationError } from './jsx/variable-application.types.js';
import type { VariableApplicationReport } from './jsx/variable-application.types.js';
import type { Logger } from './types/log.types.js';

interface ParsedArgs {
  projectPath: string;
  manifestPath: string;
  variablesPath: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const projectPath = get('--project');
  const manifestPath = get('--manifest');
  const variablesPath = get('--variables');

  if (!projectPath || !manifestPath || !variablesPath) {
    throw new Error(
      'Kullanım: npm run check:variables -- --project <gerçek .aep yolu> ' +
        '--manifest <gerçek manifest.json yolu> --variables <gerçek variables.json yolu> [--dry-run]',
    );
  }

  return {
    projectPath: resolve(projectPath),
    manifestPath: resolve(manifestPath),
    variablesPath: resolve(variablesPath),
    dryRun: argv.includes('--dry-run'),
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const config = new ConfigLoader().load();
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Manuel gerçek-proje Variable Engine testi başlıyor', { ...args });

  const apiClient = new ApiClient(config, logger, nodeIdentity);
  const { bridge } = createAdobeBridgeBundle(logger);
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

  const environmentResult = await runtime.initialize();
  if (environmentResult.status !== SystemReadyStatus.READY) {
    logger.error('Adobe Runtime NOT_READY, test çalıştırılamıyor', {
      errors: environmentResult.errors,
    });
    process.exitCode = 1;
    return;
  }

  const jobUuid = randomUUID();
  const session = await runtime.createSession(jobUuid);
  const jobWorkspace = session.getWorkspace();

  let allPassed = true;

  try {
    // Kullanıcının gerçek manifest.json/variables.json'ı, applyVariables()'ın
    // beklediği job-workspace konvansiyonuna (manifest/ ve variables/ kardeş
    // klasörler) kopyalanıyor — orijinal dosyalara asla yazılmıyor.
    const jobManifestPath = resolve(jobWorkspace.manifest, 'manifest.json');
    const jobVariablesPath = resolve(jobWorkspace.variables, 'variables.json');
    await copyFile(args.manifestPath, jobManifestPath);
    await copyFile(args.variablesPath, jobVariablesPath);
    logger.info('Gerçek manifest.json ve variables.json job workspace’e kopyalandı', {
      jobManifestPath,
      jobVariablesPath,
    });

    await afterEffectsEngine.openProject(args.projectPath);
    logger.info('Gerçek proje açıldı', { projectPath: args.projectPath });

    try {
      await afterEffectsEngine.applyVariables(jobVariablesPath, args.dryRun);
      logger.info('applyVariables() hatasız tamamlandı');
    } catch (error) {
      if (error instanceof VariableApplicationError) {
        allPassed = false;
        logger.error('Bazı değişkenler uygulanamadı', {
          updatedCount: error.report.updatedCount,
          skippedCount: error.report.skippedCount,
          failedCount: error.report.failedCount,
          errors: error.report.errors,
        });
      } else {
        throw error;
      }
    }

    if (allPassed) {
      const reportFilePath = resolve(jobWorkspace.variables, 'application-report.json');
      const report = JSON.parse(
        await readFile(reportFilePath, 'utf-8'),
      ) as VariableApplicationReport;
      logger.info('Uygulama raporu', {
        updatedCount: report.updatedCount,
        skippedCount: report.skippedCount,
        failedCount: report.failedCount,
        warnings: report.warnings,
        durationMs: report.durationMs,
        dryRun: args.dryRun,
      });
    }
  } finally {
    // Gerçek proje dosyası hiçbir koşulda kaydedilmiyor — diskteki gerçek
    // .aep bu testten önce nasıldıysa sonra da öyle kalır.
    await afterEffectsEngine.closeProject();
    await rm(jobWorkspace.root, { recursive: true, force: true }).catch(() => undefined);
  }

  if (allPassed) {
    logger.info('GERÇEK PROJE VARIABLE ENGINE TESTİ BAŞARILI');
  } else {
    logger.error('GERÇEK PROJE VARIABLE ENGINE TESTİ BAŞARISIZ');
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Manuel Variable Engine testi başarısız:', error);
  process.exitCode = 1;
});
