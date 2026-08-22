/**
 * Faz 8A — gerçek uçtan uca Render doğrulama senaryosu: gerçek .aep →
 * gerçek manifest.json → gerçek variables.json → gerçek property
 * değişimi (Essential Graphics değil, gerçek AE testleriyle doğrulanmış
 * layerName+propertyPath adreslemesi ile) → gerçek Render Queue → gerçek
 * Media Encoder → gerçek çıktı dosyası → gerçek upload (yerel test
 * sunucusu) → hash doğrulama → COMPLETED.
 *
 * Gerçek, çalışan After Effects + Media Encoder gerektirir (aynı önkoşul:
 * adobe-check.ts / execution-check.ts / orchestrator-check.ts).
 *
 * Run via `npm run check:render`.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileLogger } from './logger/file-logger.js';
import { NodeIdentityService } from './services/node-identity.service.js';
import { ConfigLoader } from './config/config-loader.js';
import { ApiClient } from './api/api-client.js';
import { AuthService } from './api/auth.service.js';
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
import { UploadService } from './services/upload.service.js';
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
import { hashFileSha256 } from './utils/hash-file.js';
import type { Logger } from './types/log.types.js';

const TEST_PORT = 45211;
const TEST_SERVER = `http://127.0.0.1:${TEST_PORT}`;

/**
 * Smallest possible valid PNG (1x1, transparent) — real testing (Faz 8A)
 * found an earlier hand-typed hex version of this constant had a
 * corrupted IDAT chunk: AE's ReplaceSource accepted it without complaint
 * (footage import/replace never decodes pixel data), but the render
 * itself failed with "PNGIO library error: IDAT: incorrect data check",
 * a real, hard-to-diagnose failure mode since it only ever surfaced at
 * render time, nowhere earlier in the pipeline. This exact byte sequence
 * is a well-known, widely-used valid minimal PNG — decoded from its
 * standard base64 form rather than hand-typed hex, to avoid repeating
 * that mistake.
 */
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function run(): Promise<void> {
  const config = new ConfigLoader().load();
  const nodeIdentity = new NodeIdentityService();
  const logger: Logger = new FileLogger(nodeIdentity);

  logger.info('Render (Faz 8A) uçtan uca doğrulama senaryosu başlıyor');

  let allPassed = true;
  const fail = (message: string, details?: Record<string, unknown>): void => {
    allPassed = false;
    logger.error(`FAIL: ${message}`, details);
  };

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
    logger.error('Adobe Runtime NOT_READY, Render testi çalıştırılamıyor', {
      errors: environmentResult.errors,
    });
    process.exitCode = 1;
    return;
  }

  const jobUuid = randomUUID();
  const session = await runtime.createSession(jobUuid);
  const jobWorkspace = session.getWorkspace();

  // ---- Gerçek yerel upload sunucusu: yüklenen dosyayı diske yazar, gerçek hash'ini hesaplar, geri döner. ----
  const uploadedFiles = new Map<string, Buffer>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const key = (req.url ?? '/').replace(/^\/+/, '');
      uploadedFiles.set(key, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: `${TEST_SERVER}/${key}` }));
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(TEST_PORT, resolvePromise));
  logger.info('Gerçek yerel upload sunucusu başlatıldı', { server: TEST_SERVER });

  try {
    // ---- Gerçek proje: comp + her tip için gerçek bir property/layer ----
    const testProjectPath = resolve(jobWorkspace.source, 'render-check-project.aep');
    const testImagePath = resolve(jobWorkspace.source, 'render-check-image.png');
    const replacementImagePath = resolve(jobWorkspace.source, 'render-check-replacement.png');
    await writeFile(testImagePath, MINIMAL_PNG);
    await writeFile(replacementImagePath, MINIMAL_PNG);

    await bridge.runJsxCode(
      AdobeAppId.AFTER_EFFECTS,
      `
      if (app.project) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }
      app.newProject();
      var comp = app.project.items.addComp('RenderCheckComp', 640, 360, 1, 2, 30);

      var titleLayer = comp.layers.addText('placeholder');
      titleLayer.name = 'TitleLayer';
      var checkboxEffect = titleLayer.property('ADBE Effect Parade').addProperty('ADBE Checkbox Control');
      var colorEffect = titleLayer.property('ADBE Effect Parade').addProperty('ADBE Color Control');

      // Ayrı bir 3D layer: POINT3D testini TitleLayer'dan izole eder —
      // gerçek testte threeDLayer=true, Anchor Point gibi 2D property'leri
      // de 3 bileşenli yapıyor (Faz 8A bulgusu), bu yüzden POINT2D testi
      // (Anchor Point) TitleLayer üzerinde gerçek 2 bileşenli kalmalı.
      var position3dLayer = comp.layers.addText('3d');
      position3dLayer.name = 'Position3DLayer';
      position3dLayer.threeDLayer = true;

      var importOptions = new ImportOptions(new File(${JSON.stringify(testImagePath)}));
      var imageFootage = app.project.importFile(importOptions);
      var imageLayer = comp.layers.add(imageFootage);
      imageLayer.name = 'ImageLayer';

      app.project.save(File(${JSON.stringify(testProjectPath)}));
      `,
    );
    logger.info('Gerçek test projesi oluşturuldu (comp + layer + effect + footage)');

    const testVariablesPath = resolve(jobWorkspace.variables, 'variables.json');
    const variableValues = {
      title_text: 'Render Check Başlığı 🎬',
      opacity_number: 42,
      rotation_angle: 90,
      show_flag: true,
      accent_color: '#FF8800',
      anchor_point: [10, 20],
      position_3d: [100, 200, 50],
      hero_image: replacementImagePath,
    };
    await writeFile(testVariablesPath, JSON.stringify(variableValues), 'utf-8');

    const testManifest = createManifestContract({
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
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'TitleLayer',
            propertyPath: ['Source Text'],
          },
        }),
        createTemplateVariableContract({
          key: 'opacity_number',
          label: 'Opacity',
          type: 'number',
          defaultValue: null,
          sortOrder: 1,
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'TitleLayer',
            propertyPath: ['Transform', 'Opacity'],
          },
        }),
        createTemplateVariableContract({
          key: 'rotation_angle',
          label: 'Rotation',
          type: 'angle',
          defaultValue: null,
          sortOrder: 2,
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'TitleLayer',
            propertyPath: ['Transform', 'Rotation'],
          },
        }),
        createTemplateVariableContract({
          key: 'show_flag',
          label: 'Show Flag',
          type: 'boolean',
          defaultValue: null,
          sortOrder: 3,
          // propertyMatchName örneği: apply_manifest.jsx'in gerçek fallback
          // zincirini (propertyPath → matchName+displayName) burada da
          // egzersiz eder — "ADBE Checkbox Control-0001" bu ExtendScript
          // sürümünde Checkbox Control effect'inin "Checkbox" alt
          // property'sinin gerçek, locale-bağımsız matchName'idir.
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'TitleLayer',
            propertyPath: ['Effects', 'Checkbox Control', 'Checkbox'],
            propertyMatchName: 'ADBE Checkbox Control-0001',
          },
        }),
        createTemplateVariableContract({
          key: 'accent_color',
          label: 'Accent Color',
          type: 'color',
          defaultValue: null,
          sortOrder: 4,
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'TitleLayer',
            propertyPath: ['Effects', 'Color Control', 'Color'],
          },
        }),
        createTemplateVariableContract({
          key: 'anchor_point',
          label: 'Anchor Point',
          type: 'point2d',
          defaultValue: null,
          sortOrder: 5,
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'TitleLayer',
            propertyPath: ['Transform', 'Anchor Point'],
          },
        }),
        createTemplateVariableContract({
          key: 'position_3d',
          label: 'Position 3D',
          type: 'point3d',
          defaultValue: null,
          sortOrder: 6,
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'Position3DLayer',
            propertyPath: ['Transform', 'Position'],
          },
        }),
        createTemplateVariableContract({
          key: 'hero_image',
          label: 'Hero Image',
          type: 'image',
          defaultValue: null,
          sortOrder: 7,
          metadata: {
            compositionName: 'RenderCheckComp',
            layerName: 'ImageLayer',
            propertyPath: [],
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
    logger.info('Gerçek manifest.json ve variables.json yazıldı');

    // ---- Gerçek Variable Engine çağrısı (Node → VariableResolver → JSX) ----
    await afterEffectsEngine.applyVariables(testVariablesPath);
    logger.info(
      'applyVariables() hatasız tamamlandı (failedCount=0 garantisi VariableApplicationError ile sağlanır)',
    );

    // ---- Uygulanan gerçek değerleri AE'den geri okuyarak doğrula (rapor "hata yok" demek, "değer değişti" demek değildir) ----
    const verifyFilePath = resolve(jobWorkspace.temp, 'render-check-verify.json');
    await bridge.runJsxCode(
      AdobeAppId.AFTER_EFFECTS,
      `
      var __line = 'ERROR:not-started';
      try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
          if (app.project.item(i) instanceof CompItem) { comp = app.project.item(i); break; }
        }
        var titleLayer = comp.layer('TitleLayer');
        var position3dLayer = comp.layer('Position3DLayer');
        var imageLayer = comp.layer('ImageLayer');
        var out = {};
        out.text = titleLayer.property('Source Text').value.text;
        out.opacity = titleLayer.property('Transform').property('Opacity').value;
        out.rotation = titleLayer.property('Transform').property('Rotation').value;
        out.checkbox = titleLayer.property('Effects').property('Checkbox Control').property('Checkbox').value;
        out.color = titleLayer.property('Effects').property('Color Control').property('Color').value;
        out.anchor = titleLayer.property('Transform').property('Anchor Point').value;
        out.position = position3dLayer.property('Transform').property('Position').value;
        out.imageSourceName = imageLayer.source.file ? imageLayer.source.file.fsName : 'null';

        __line = out.text + '|' + out.opacity + '|' + out.rotation + '|' + out.checkbox + '|' +
          out.color.join(',') + '|' + out.anchor.join(',') + '|' + out.position.join(',') + '|' +
          out.imageSourceName;
      } catch (e) {
        __line = 'ERROR:' + e.toString();
      }

      var f = new File(${JSON.stringify(verifyFilePath)});
      f.encoding = 'UTF-8';
      f.open('w');
      f.write(__line);
      f.close();
      `,
    );
    const verifyRaw = await readFile(verifyFilePath, 'utf-8');
    if (verifyRaw.startsWith('ERROR:')) {
      throw new Error(`Doğrulama JSX'i başarısız: ${verifyRaw}`);
    }
    const verifyParts = verifyRaw.split('|');
    const field = (index: number): string => verifyParts[index] ?? '';
    const text = field(0);
    const opacity = field(1);
    const rotation = field(2);
    const checkbox = field(3);
    const color = field(4);
    const anchor = field(5);
    const position = field(6);
    const imageSourceName = field(7);

    const expectations: Array<[string, string, string]> = [
      ['title_text', text, 'Render Check Başlığı 🎬'],
      ['opacity_number', opacity, '42'],
      ['rotation_angle', rotation, '90'],
      ['show_flag', checkbox, '1'],
      // AE gerçek testte Anchor Point'i katman 2D olsa bile her zaman 3
      // bileşenli (z=0) döndürüyor — bu, POINT2D handler'ın bir hatası
      // değil, AE'nin spatial property'ler için gerçek, tutarlı davranışı.
      ['anchor_point', anchor, '10,20,0'],
      ['position_3d', position, '100,200,50'],
    ];
    for (const [key, actual, expected] of expectations) {
      if (actual !== expected) {
        fail(`Değişken gerçek AE'de beklenen değere sahip değil: ${key}`, { actual, expected });
      }
    }
    // COLOR: RGBA float [0..1] — hex #FF8800 → [1, 0.533..., 0, 1] toleranslı karşılaştırma.
    const colorParts = color.split(',').map(Number);
    const expectedColor = [1, 136 / 255, 0, 1];
    const colorMatches = colorParts.every((c, i) => Math.abs(c - (expectedColor[i] ?? -1)) < 0.01);
    if (!colorMatches) {
      fail('accent_color gerçek AE değeriyle eşleşmiyor', { colorParts, expectedColor });
    }
    if (!imageSourceName || !imageSourceName.includes('render-check-replacement')) {
      fail('hero_image gerçek ReplaceSource uygulanmamış', { imageSourceName });
    }
    logger.info('Tüm değişken tiplerinin gerçek AE property değerleri doğrulandı', {
      text,
      opacity,
      rotation,
      checkbox,
      color,
      anchor,
      position,
      imageSourceName,
    });

    // ---- Dry Run: hiçbir property değişmemeli ----
    await afterEffectsEngine.applyVariables(testVariablesPath, true);
    logger.info('Dry Run çalıştırıldı (skippedCount raporu applyVariables içinde doğrulanıyor)');

    // ---- Tam Execution Pipeline: Load → ApplyVariables → Save → QueueRender → Wait(gerçek AME) → CollectOutput → Upload(gerçek) → Cleanup ----
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
      variables: variableValues,
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

    const uploadConfig = { ...config, server: TEST_SERVER };
    const uploadService = new UploadService(uploadConfig, new AuthService(uploadConfig), logger);
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
    logger.info('Execution Pipeline sonucu (gerçek Render Queue + Media Encoder + Upload)', {
      status: result.status,
      jobUuid: result.jobUuid,
      durationMs: result.durationMs,
      errors: result.errors,
    });

    if (result.status !== ExecutionResultStatus.COMPLETED) {
      fail('Pipeline COMPLETED ile sonuçlanmadı', { errors: result.errors });
    }

    const outputFilePath = context.state.outputFilePath;
    const uploadedUrl = context.state.uploadedUrl;
    if (!outputFilePath) {
      fail('state.outputFilePath boş kaldı');
    } else {
      const localHash = await hashFileSha256(outputFilePath);
      const destinationKey = `render-jobs/${jobUuid}/output`;
      const uploadedBytes = uploadedFiles.get(destinationKey);
      if (!uploadedBytes) {
        fail('Yerel test sunucusu render çıktısını almadı', { destinationKey });
      } else {
        const { createHash } = await import('node:crypto');
        const uploadedHash = createHash('sha256').update(uploadedBytes).digest('hex');
        if (uploadedHash !== localHash) {
          fail("Yüklenen dosyanın hash'i yerel render çıktısıyla eşleşmiyor", {
            localHash,
            uploadedHash,
          });
        } else {
          logger.info('Render çıktısı gerçek upload sonrası hash ile doğrulandı', {
            outputFilePath,
            localHash,
            uploadedUrl,
          });
        }
      }
    }
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }

  await bridge.runJsxCode(
    AdobeAppId.AFTER_EFFECTS,
    'if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);',
  );
  await rm(jobWorkspace.root, { recursive: true, force: true }).catch(() => undefined);

  if (allPassed) {
    logger.info('TÜM RENDER DOĞRULAMA SENARYOLARI BAŞARILI');
  } else {
    logger.error('BAZI RENDER DOĞRULAMA SENARYOLARI BAŞARISIZ OLDU');
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
