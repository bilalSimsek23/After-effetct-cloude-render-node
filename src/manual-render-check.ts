/**
 * Manuel, gerçek-proje uçtan uca RENDER testi (Faz 8C) — manual-variable-
 * check.ts'in genişletilmişi: gerçek `.aep` + gerçek `manifest.json` +
 * gerçek `variables.json` alır, değişkenleri uygular, GERÇEK bir render
 * alır ve çıktı videosunu kullanıcının belirttiği gerçek bir klasöre yazar
 * — sentetik proje/upload sunucusu yok, kullanıcı çıktıyı kendi
 * izleyecek/kontrol edecek.
 *
 * Render hedefi composition: manifest'in `metadata.renderComposition`
 * alanından okunur (bkz. docs/scanner-manifest-metadata-contract.md ve
 * generate_manifest.jsx'teki "Final Comp" tespiti) — verilmezse JSX
 * tarafının eski "ilk comp'u al" davranışına düşülür (tek comp'lu projeler
 * için güvenli, çok comp'lu gerçek projelerde manifest'in bunu doldurmuş
 * olması beklenir).
 *
 * Gerçek proje dosyası HİÇBİR ZAMAN kaydedilmez: proje `CloseOptions.
 * DO_NOT_SAVE_CHANGES` ile kapatılır, diskteki gerçek .aep bu testten önce
 * nasılsa sonra da öyle kalır. Render ÇIKTISI ise kalıcıdır — `--output`
 * ile belirtilen gerçek dosya, test bittikten sonra da silinmez.
 *
 * Kullanım:
 *   npm run check:render:manual -- --project "/gerçek/proje.aep" \
 *     --manifest "/gerçek/manifest.json" --variables "/gerçek/variables.json" \
 *     --output "/gerçek/klasör/cikti.mp4" [--profile preview|master] [--timeout-ms 600000]
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
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
import { RenderProfileRegistry } from './adobe/models/render-profile.registry.js';
import {
  RenderProfileCode,
  getAdobeOutputModuleTemplate,
} from './adobe/models/render-profile.types.js';
import { SystemReadyStatus } from './adobe/models/environment-check.types.js';
import { JsxRuntimeService } from './jsx/jsx-runtime.service.js';
import { VariableResolver } from './jsx/variable-resolver.js';
import { VariableApplicationError } from './jsx/variable-application.types.js';
import type { ManifestContract } from './contracts/manifest.contract.js';
import type { Logger } from './types/log.types.js';

interface ParsedArgs {
  projectPath: string;
  manifestPath: string;
  variablesPath: string;
  outputPath: string;
  profileCode: string;
  timeoutMs: number | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const projectPath = get('--project');
  const manifestPath = get('--manifest');
  const variablesPath = get('--variables');
  const outputPath = get('--output');
  const profileCode = get('--profile') ?? RenderProfileCode.PREVIEW;
  const timeoutRaw = get('--timeout-ms');

  if (!projectPath || !manifestPath || !variablesPath || !outputPath) {
    throw new Error(
      'Kullanım: npm run check:render:manual -- --project <gerçek .aep yolu> ' +
        '--manifest <gerçek manifest.json yolu> --variables <gerçek variables.json yolu> ' +
        '--output <gerçek çıktı dosya yolu> [--profile preview|master] [--timeout-ms 600000]',
    );
  }

  return {
    projectPath: resolve(projectPath),
    manifestPath: resolve(manifestPath),
    variablesPath: resolve(variablesPath),
    outputPath: resolve(outputPath),
    profileCode,
    timeoutMs: timeoutRaw ? Number(timeoutRaw) : undefined,
  };
}

/** Swaps `filePath`'s extension for `newExt` (e.g. ".mp4") — used because AE can silently rewrite the real output container format (see AfterEffectsRenderEngine's own note on actualOutputFilePath). */
function withExtension(filePath: string, newExt: string): string {
  const currentExt = extname(filePath);
  const base = currentExt ? filePath.slice(0, -currentExt.length) : filePath;
  return base + newExt;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const config = new ConfigLoader().load();
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Manuel gerçek-proje uçtan uca render testi başlıyor', { ...args });

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

  const renderProfileRegistry = new RenderProfileRegistry(config.renderProfiles);
  const renderProfile = renderProfileRegistry.find(args.profileCode);
  if (!renderProfile) {
    logger.error(`Render profili bulunamadı: ${args.profileCode}`);
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(await readFile(args.manifestPath, 'utf-8')) as ManifestContract;
  const renderComposition =
    manifest.metadata && typeof manifest.metadata.renderComposition === 'string'
      ? manifest.metadata.renderComposition
      : null;
  const requiresAlpha =
    manifest.metadata && typeof manifest.metadata.requiresAlpha === 'boolean'
      ? manifest.metadata.requiresAlpha
      : false;
  const renderDurationSeconds =
    manifest.metadata && typeof manifest.metadata.renderDurationSeconds === 'number'
      ? manifest.metadata.renderDurationSeconds
      : null;
  logger.info('Manifest okundu', {
    variableCount: manifest.variables.length,
    renderComposition,
    requiresAlpha,
    renderDurationSeconds,
  });
  if (!renderComposition) {
    logger.warn(
      "manifest.metadata.renderComposition boş - JSX tarafı Project panelindeki ilk composition'ı render edecek. " +
        "Gerçek projede birden fazla comp varsa bu YANLIŞ comp'u render edebilir.",
    );
  }

  // requiresAlpha (Faz 8C) — bu manifest'in kendi talebi, --profile ile
  // seçilen preview/master'ı görmezden gelip her zaman "alpha" render
  // profilinin şablonunu kullanır (config.json'da tanımlı, gerçek
  // "High Quality with Alpha" şablonu). manifest.metadata.requiresAlpha
  // false/yoksa normal --profile seçimi aynen kullanılır.
  let effectiveRenderProfile = renderProfile;
  if (requiresAlpha) {
    const alphaProfile = renderProfileRegistry.find('alpha');
    if (!alphaProfile) {
      logger.error(
        "manifest requiresAlpha istiyor ama config.json'da 'alpha' render profili tanımlı değil.",
      );
      process.exitCode = 1;
      return;
    }
    effectiveRenderProfile = alphaProfile;
  }
  const rendererPreset = getAdobeOutputModuleTemplate(effectiveRenderProfile);
  logger.info('Kullanılacak render şablonu', {
    profileCode: effectiveRenderProfile.code,
    rendererPreset,
  });

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
    const jobManifestPath = resolve(jobWorkspace.manifest, 'manifest.json');
    const jobVariablesPath = resolve(jobWorkspace.variables, 'variables.json');
    await copyFile(args.manifestPath, jobManifestPath);
    await copyFile(args.variablesPath, jobVariablesPath);

    await afterEffectsEngine.openProject(args.projectPath);
    logger.info('Gerçek proje açıldı', { projectPath: args.projectPath });

    try {
      await afterEffectsEngine.applyVariables(jobVariablesPath, false);
      logger.info('Değişkenler uygulandı');
    } catch (error) {
      if (error instanceof VariableApplicationError) {
        allPassed = false;
        logger.error('Bazı değişkenler uygulanamadı - render yine de denenecek', {
          updatedCount: error.report.updatedCount,
          failedCount: error.report.failedCount,
          errors: error.report.errors,
        });
      } else {
        throw error;
      }
    }

    // AfterEffectsRenderEngine.enqueue() derives its internal report-file
    // path from outputFilePath assuming it sits two directory levels below
    // a real job workspace root (jobWorkspace.preview/master, siblings of
    // jobWorkspace.temp) - the same convention QueueRenderStage's real
    // production call always follows. --output is an arbitrary user path
    // (e.g. Desktop), so we render into the job workspace first and copy
    // the real result out afterward, rather than passing --output directly.
    const jobOutputPath = resolve(
      jobWorkspace.preview,
      withExtension('render-output.mp4', extname(args.outputPath) || '.mp4'),
    );

    const enqueueResult = await renderEngine.enqueue(
      args.projectPath,
      jobOutputPath,
      rendererPreset,
      renderComposition,
      renderDurationSeconds,
    );
    logger.info('Render kuyruğa alındı', {
      ...enqueueResult,
      renderComposition,
      renderDurationSeconds,
    });

    await renderEngine.waitForRenderCompletion(
      enqueueResult.actualOutputFilePath,
      enqueueResult.renderQueueItemIndex,
      args.timeoutMs,
    );

    // Gerçek final dosya adı AE'nin gerçekte ürettiği uzantıyı taşır -
    // --output'ta istenen uzantı farklıysa (ör. .mov istendi ama .mp4
    // üretildi), kullanıcıya yanlış/bozuk bir dosya bırakmamak için gerçek
    // uzantı korunur.
    const finalOutputPath = withExtension(
      args.outputPath,
      extname(enqueueResult.actualOutputFilePath),
    );
    await mkdir(dirname(finalOutputPath), { recursive: true });
    await copyFile(enqueueResult.actualOutputFilePath, finalOutputPath);

    logger.info('GERÇEK RENDER TAMAMLANDI', {
      outputFilePath: finalOutputPath,
    });
  } finally {
    // Gerçek proje dosyası hiçbir koşulda kaydedilmiyor - diskteki gerçek
    // .aep bu testten önce nasıldıysa sonra da öyle kalır. Render çıktısı
    // ise --output'ta belirtilen gerçek yolda kalıcı olarak duruyor.
    await afterEffectsEngine.closeProject();
    await rm(jobWorkspace.root, { recursive: true, force: true }).catch(() => undefined);
  }

  if (allPassed) {
    logger.info('GERÇEK PROJE UÇTAN UCA RENDER TESTİ BAŞARILI - çıktıyı izleyip kontrol edin');
  } else {
    logger.error('GERÇEK PROJE UÇTAN UCA RENDER TESTİ - DEĞİŞKEN UYGULAMADA HATA VARDI');
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error('[FATAL] Manuel render testi başarısız:', error);
  process.exitCode = 1;
});
