/**
 * Standalone verification for the Platform Contract Layer — proves every
 * Contract can be created, validated, and round-tripped through its
 * Serializer, all via the ContractRegistry (never by importing a
 * Contract file directly). Run via `npm run check:contracts`.
 */
import { randomUUID } from 'node:crypto';
import { createDefaultContractRegistry } from './contracts/registry/default-contract-registry.js';
import { ContractName } from './contracts/registry/contract-name.js';
import { ContractValidationError } from './contracts/registry/contract-validator.js';
import { isContractVersionCompatible } from './contracts/contract-version.js';

import { createManifestContract } from './contracts/manifest.contract.js';
import { createTemplateVariableContract } from './contracts/template-variable.contract.js';
import { createScannerResultContract } from './contracts/scanner-result.contract.js';
import { createDependencyContract } from './contracts/dependency.contract.js';
import { AssetType, createAssetContract } from './contracts/asset.contract.js';
import {
  RenderProfileCode,
  createRenderProfileContract,
} from './contracts/render-profile.contract.js';
import {
  RenderJobPriority,
  RenderJobRenderType,
  createRenderJobContract,
} from './contracts/render-job.contract.js';
import { createRenderResultContract } from './contracts/render-result.contract.js';
import {
  RenderProgressStatus,
  createRenderProgressContract,
} from './contracts/render-progress.contract.js';
import { createRenderNodeContract } from './contracts/render-node.contract.js';
import {
  SystemStatusCode,
  createSystemStatusContract,
} from './contracts/system-status.contract.js';
import { createAdobeEnvironmentContract } from './contracts/adobe-environment.contract.js';
import { createWorkspaceContract } from './contracts/workspace.contract.js';
import { createJobLeaseContract } from './contracts/job-lease.contract.js';
import { createJobClaimContract } from './contracts/job-claim.contract.js';
import { createJobHeartbeatContract } from './contracts/job-heartbeat.contract.js';
import { createCapabilityReportContract } from './contracts/capability-report.contract.js';

function buildSamples() {
  const templateVariable = createTemplateVariableContract({
    key: 'title_text',
    label: 'Title Text',
    type: 'text',
    defaultValue: 'Hello',
    sortOrder: 1,
    metadata: null,
  });

  const manifest = createManifestContract({
    schemaVersion: '1.0.0',
    scannerVersion: '1.0.0',
    engine: 'after-effects',
    variables: [templateVariable],
    metadata: {},
  });

  const asset = createAssetContract({
    uuid: randomUUID(),
    hash: 'abc123',
    size: 1024,
    type: AssetType.PREVIEW,
    downloadUrl: 'https://example.test/preview.mp4',
    cacheKey: 'preview-cache-key',
  });

  const lease = createJobLeaseContract({
    leaseId: randomUUID(),
    leaseExpireAt: new Date(Date.now() + 60_000).toISOString(),
    renewIntervalSeconds: 20,
    retryCount: 0,
  });

  return {
    [ContractName.TEMPLATE_VARIABLE]: templateVariable,
    [ContractName.MANIFEST]: manifest,
    [ContractName.SCANNER_RESULT]: createScannerResultContract({
      success: true,
      manifest,
      errors: [],
      durationMs: 1200,
    }),
    [ContractName.DEPENDENCY]: createDependencyContract({
      fonts: [{ family: 'Montserrat', style: 'Bold', autoInstall: true }],
      plugins: [{ name: 'Saber', required: true, autoInstall: false }],
      presets: [{ name: 'Preview.epr' }],
      scripts: [{ name: 'prepare.jsx' }],
      licenses: [{ name: 'LICENSE.txt' }],
      luts: [{ name: 'Rec709.cube' }],
      expressions: [{ name: 'wiggle-helper.jsx' }],
      assets: [{ name: 'logo.png' }],
    }),
    [ContractName.ASSET]: asset,
    [ContractName.RENDER_PROFILE]: createRenderProfileContract({
      code: RenderProfileCode.PREVIEW,
      name: 'Preview',
      mediaEncoderPreset: null,
      watermarkEnabled: true,
      isActive: true,
    }),
    [ContractName.RENDER_JOB]: createRenderJobContract({
      jobUuid: randomUUID(),
      templateUuid: randomUUID(),
      projectUuid: randomUUID(),
      userUuid: randomUUID(),
      variables: { title_text: 'Hello' },
      priority: RenderJobPriority.NORMAL,
      renderType: RenderJobRenderType.PREVIEW,
    }),
    [ContractName.RENDER_RESULT]: createRenderResultContract({
      previewUrl: 'https://example.test/preview.mp4',
      masterUrl: null,
      durationSeconds: 12.5,
      files: [asset],
      logs: ['render started', 'render finished'],
      warnings: [],
    }),
    [ContractName.RENDER_PROGRESS]: createRenderProgressContract({
      status: RenderProgressStatus.RENDERING,
      percentage: 42,
      currentStep: 'Rendering frames',
      estimatedRemainingSeconds: 30,
    }),
    [ContractName.RENDER_NODE]: createRenderNodeContract({
      nodeUuid: randomUUID(),
      nodeName: 'Mac Mini M4 #1',
      engine: 'after-effects',
      supportedEngines: ['after-effects'],
      agentVersion: '1.0.0',
      applicationVersion: '0.1.0',
    }),
    [ContractName.SYSTEM_STATUS]: createSystemStatusContract({
      status: SystemStatusCode.READY,
      errors: [],
      details: null,
    }),
    [ContractName.ADOBE_ENVIRONMENT]: createAdobeEnvironmentContract({
      status: SystemStatusCode.READY,
      errors: [],
      afterEffects: { name: 'Adobe After Effects', installed: true, version: '26.3.0' },
      mediaEncoder: { name: 'Adobe Media Encoder', installed: true, version: '26.3.1' },
      sameMajorVersionFamily: true,
      dynamicLinkAvailable: true,
      workspaceReady: true,
    }),
    [ContractName.WORKSPACE]: createWorkspaceContract({
      jobUuid: randomUUID(),
      workspace: '/workspace',
      source: '/workspace/source',
      preview: '/workspace/preview',
      master: '/workspace/master',
      cache: '/workspace/cache',
      logs: '/workspace/logs',
      dependency: '/workspace/dependency',
      extracted: '/workspace/extracted',
      manifest: '/workspace/manifest',
      variables: '/workspace/variables',
    }),
    [ContractName.JOB_LEASE]: lease,
    [ContractName.JOB_CLAIM]: createJobClaimContract({
      jobUuid: randomUUID(),
      nodeUuid: randomUUID(),
      claimedAt: new Date().toISOString(),
      lease,
    }),
    [ContractName.JOB_HEARTBEAT]: createJobHeartbeatContract({
      nodeUuid: randomUUID(),
      uptimeSeconds: 120,
      memory: {
        totalBytes: 17179869184,
        usedBytes: 8000000000,
        freeBytes: 9179869184,
        usagePercent: 46.6,
      },
      runningJobs: 0,
      maxConcurrentJobs: 1,
      applicationVersion: '0.1.0',
      agentVersion: '1.0.0',
    }),
    [ContractName.CAPABILITY_REPORT]: createCapabilityReportContract({
      nodeUuid: randomUUID(),
      nodeName: 'Mac Mini M4 #1',
      hostname: 'test-host',
      operatingSystem: 'darwin 25.5.0',
      architecture: 'arm64',
      adobe: {
        afterEffectsVersion: '26.3.0',
        mediaEncoderVersion: '26.3.1',
        dynamicLinkAvailable: true,
      },
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
      performance: { maxConcurrentJobs: 1, currentRunningJobs: 0, maxQueueLength: 5 },
    }),
  } as const;
}

function run(): void {
  const registry = createDefaultContractRegistry();
  const samples = buildSamples();

  console.log(`Registry'de kayıtlı Contract sayısı: ${registry.listContracts().length}`);

  let allPassed = true;

  for (const [name, sample] of Object.entries(samples)) {
    try {
      const entry = registry.getContract(name as ContractName);

      // 1. Validate the freshly-created sample.
      registry.validate(name as ContractName, sample);

      // 2. Round-trip through the Contract's own Serializer.
      const json = entry.serializer.serialize(sample);
      const roundTripped = entry.serializer.deserialize(json);
      registry.validate(name as ContractName, roundTripped);

      // 3. Sanity-check the registry's own bookkeeping APIs.
      const currentVersion = registry.getCurrentVersion(name as ContractName);
      if (!registry.isSupported(name as ContractName, currentVersion)) {
        throw new Error(`isSupported(${name}, ${currentVersion}) false döndü`);
      }

      console.log(
        `OK  ${name} (schema=${registry.getSchema(name as ContractName)}, version=${currentVersion})`,
      );
    } catch (error) {
      allPassed = false;
      console.error(`FAIL ${name}:`, error);
    }
  }

  // Negative case: a deliberately broken Manifest must fail validation.
  try {
    registry.validate(ContractName.MANIFEST, {
      schema: 'manifest',
      version: '1.0.0',
      createdAt: 'now',
    });
    console.error('FAIL: geçersiz Manifest doğrulaması hata fırlatmadı');
    allPassed = false;
  } catch (error) {
    if (error instanceof ContractValidationError) {
      console.log(`OK  geçersiz Manifest doğru şekilde reddedildi: ${error.issues.join(', ')}`);
    } else {
      allPassed = false;
      console.error('FAIL: beklenmeyen hata tipi', error);
    }
  }

  // Version compatibility helper.
  const compatible = isContractVersionCompatible('1.2.0', '1.0.0');
  const incompatible = isContractVersionCompatible('2.0.0', '1.0.0');
  console.log(`isContractVersionCompatible(1.2.0, 1.0.0) = ${compatible} (beklenen: true)`);
  console.log(`isContractVersionCompatible(2.0.0, 1.0.0) = ${incompatible} (beklenen: false)`);
  if (!compatible || incompatible) {
    allPassed = false;
  }

  if (allPassed) {
    console.log('Senaryo başarılı: tüm Contract’lar oluşturuldu, doğrulandı ve round-trip edildi.');
    process.exitCode = 0;
  } else {
    console.error('Senaryo başarısız.');
    process.exitCode = 1;
  }
}

run();
