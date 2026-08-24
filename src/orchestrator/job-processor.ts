import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import type { ILaravelApiClient } from '../api/laravel-api.client.js';
import { createRenderJobContract } from '../contracts/render-job.contract.js';
import type {
  RenderJobContract,
  RenderJobPriority,
  RenderJobRenderType,
} from '../contracts/render-job.contract.js';
import type { AdobeRuntimeService } from '../adobe/runtime/adobe-runtime.service.js';
import type { AdobeWorkspaceService } from '../adobe/runtime/adobe-workspace.service.js';
import type { CapabilityRegistry } from '../capabilities/capability-registry.js';
import { RenderProfileCode } from '../adobe/models/render-profile.types.js';
import type { RenderProfileRegistry } from '../adobe/models/render-profile.registry.js';
import type { IProjectPreparationService } from '../preparation/project-preparation.service.js';
import { PreparedProjectStatus } from '../preparation/prepared-project.types.js';
import { ExecutionContextBuilder } from '../execution/execution-context-builder.js';
import type { ExecutionPipeline } from '../execution/execution-pipeline.js';
import type { IProgressService } from '../services/progress.service.js';
import type { IRetryPolicyService } from '../services/retry-policy.service.js';
import type { IResultForwarder } from './result-forwarder.js';
import type { JobRuntimeStats } from '../heartbeat/job-runtime-stats.interface.js';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { Logger } from '../types/log.types.js';
import { RenderNodeError } from '../errors/render-node-error.js';
import type {
  RenderNodeDownloadableAsset,
  RenderNodeDownloadablePackage,
  RenderNodeTemplateManifestSource,
} from '../types/render-node-job-payload.types.js';

/**
 * Builds an empty-but-valid dependency-package.zip locally when Laravel
 * reports no dependency package for a template — DependencyPackageService
 * (Phase 3, untouched) always expects a real zip file to extract; an
 * empty package (no fonts/plugins/presets/...) is explicitly valid per its
 * own spec, so this only ever supplies the shape, never invents content.
 */
async function buildEmptyDependencyPackage(destinationPath: string): Promise<void> {
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

/**
 * The real Render Job → PreparedProject → ExecutionPipeline → Result
 * pipeline. Unlike the old JobPoller this replaces, this class never picks
 * a job itself — Laravel decides assignment and pushes a notification
 * (PushServer receives it, verifies it, and calls handleAssignedJob() here)
 * ("Node kendi kendine Job seçmeyecektir... Retry kararı vermeyecektir").
 * It knows nothing about render mechanics — Project Preparation and
 * Execution Pipeline own all of that, untouched from Phase 4/5.
 */
export class JobProcessor implements JobRuntimeStats {
  private activeJobCount = 0;
  // Community Render Asset Protection & Project Lifecycle Security phase —
  // activeJobCount alone (a raw counter) can't tell a stale-workspace
  // sweep which specific job UUIDs are currently in flight. Tracked
  // alongside it so cleanupExpiredWorkspaces() has a hard, UUID-precise
  // exclusion set rather than relying on mtime timing alone.
  private readonly activeJobUuids = new Set<string>();

  constructor(
    private readonly laravelApiClient: ILaravelApiClient,
    private readonly adobeRuntimeService: AdobeRuntimeService,
    private readonly workspaceService: AdobeWorkspaceService,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly renderProfileRegistry: RenderProfileRegistry,
    private readonly projectPreparationService: IProjectPreparationService,
    private readonly executionContextBuilder: ExecutionContextBuilder,
    private readonly executionPipeline: ExecutionPipeline,
    private readonly progressForwarder: IProgressService,
    private readonly retryPolicy: IRetryPolicyService,
    private readonly resultForwarder: IResultForwarder,
    private readonly config: RenderNodeConfig,
    private readonly logger: Logger,
  ) {}

  getRunningJobCount(): number {
    return this.activeJobCount;
  }

  /**
   * Community Render Asset Protection & Project Lifecycle Security phase —
   * consulted by a stale-workspace sweep (see NodeRunner) so an in-flight
   * job's workspace is never a deletion candidate, independent of mtime.
   */
  getActiveJobUuids(): ReadonlySet<string> {
    return this.activeJobUuids;
  }

  /**
   * Entry point called by PushServer once it has verified Laravel's push
   * notification signature. Claims the specific job, then processes it —
   * never awaited by the caller (a push notification's HTTP response
   * should return immediately; the render itself can take minutes).
   */
  async handleAssignedJob(jobUuid: string, claimToken: string): Promise<void> {
    if (this.activeJobCount >= this.config.maxConcurrentJobs) {
      // Laravel's own RenderNode.hasCapacity() check (driven by heartbeat-
      // reported capacity) should prevent this in practice - this is a
      // defensive fallback, not the primary capacity control. Tell Laravel
      // immediately rather than silently dropping the push: otherwise the
      // job just sits Assigned to this node until claim_expires_at lapses
      // (several minutes) before it becomes eligible for reassignment.
      this.logger.warn('Maksimum eşzamanlı iş sınırına ulaşıldı, push bildirimi reddediliyor', {
        jobUuid,
        activeJobCount: this.activeJobCount,
      });
      await this.laravelApiClient
        .declineRenderJob(jobUuid, 'Node maksimum eşzamanlı iş sınırına ulaştı.')
        .catch((error) => {
          this.logger.error('İş reddi Laravel’e iletilemedi', {
            jobUuid,
            error: (error as Error).message,
          });
        });
      return;
    }

    let payload;
    try {
      payload = await this.laravelApiClient.claimRenderJob(jobUuid, claimToken);
    } catch (error) {
      this.logger.error('İş sahiplenme (claim) başarısız oldu', {
        jobUuid,
        error: (error as Error).message,
      });
      return;
    }

    const job = createRenderJobContract({
      jobUuid: payload.jobUuid,
      templateUuid: payload.templateUuid,
      projectUuid: payload.projectUuid,
      userUuid: payload.userUuid ?? '',
      variables: payload.variables,
      priority: payload.priority as RenderJobPriority,
      renderType: payload.renderType as RenderJobRenderType,
    });

    await this.processJob(
      job,
      payload.template,
      payload.projectAsset,
      payload.projectPackage,
      payload.variableAssets ?? {},
    );
  }

  private async processJob(
    job: RenderJobContract,
    templateManifestSource: RenderNodeTemplateManifestSource,
    projectAsset: RenderNodeDownloadableAsset | null,
    projectPackage: RenderNodeDownloadablePackage | null,
    variableAssets: Record<string, RenderNodeDownloadableAsset>,
  ): Promise<void> {
    const { jobUuid, templateUuid, renderType } = job;
    this.activeJobCount += 1;
    this.activeJobUuids.add(jobUuid);
    this.logger.info('Yeni iş alındı', { jobUuid, templateUuid });

    try {
      const capabilityReport = this.capabilityRegistry.getCapabilities();
      if (!capabilityReport) {
        throw new Error('CapabilityRegistry henüz bir Capability Report üretmedi.');
      }

      const renderProfile = this.renderProfileRegistry.find(renderType as RenderProfileCode);
      if (!renderProfile) {
        throw new Error(`"${renderType}" için bir Render Profile bulunamadı.`);
      }

      if (!projectAsset) {
        throw new Error('Laravel bu iş için bir proje dosyası (projectAsset) döndürmedi.');
      }

      const nodePaths = this.workspaceService.getPaths();
      const localTemplateAssetFilePath = resolve(nodePaths.temp, `${jobUuid}-template.zip`);
      const localDependencyPackageZipPath = resolve(nodePaths.temp, `${jobUuid}-dependency.zip`);

      await this.laravelApiClient.downloadAsset(
        projectAsset.downloadUrl,
        localTemplateAssetFilePath,
      );

      if (projectPackage) {
        await this.laravelApiClient.downloadAsset(
          projectPackage.downloadUrl,
          localDependencyPackageZipPath,
        );
      } else {
        await buildEmptyDependencyPackage(localDependencyPackageZipPath);
      }

      const preparedProject = await this.projectPreparationService.prepare({
        renderJob: job,
        engine: this.config.engine,
        capabilityReport,
        localTemplateAssetFilePath,
        expectedProjectAssetHash: projectAsset.checksumSha256,
        templateManifestSource,
        localDependencyPackageZipPath,
        dependencyPackageVersion: projectPackage?.version ?? 1,
        variableAssets,
      });

      if (preparedProject.status !== PreparedProjectStatus.READY) {
        await this.resultForwarder.sendFailed(jobUuid, preparedProject.errors);
        return;
      }

      const session = await this.adobeRuntimeService.createSession(jobUuid);

      try {
        const context = this.executionContextBuilder.build({
          job,
          preparedProject,
          adobeSession: session,
          renderProfile,
          progressService: this.progressForwarder,
          retryPolicy: this.retryPolicy,
          logger: this.logger,
        });

        const result = await this.executionPipeline.run(context);
        await this.resultForwarder.send(jobUuid, result);
      } finally {
        await this.adobeRuntimeService.closeSession(jobUuid);
      }
    } catch (error) {
      // Same "[CODE] message" convention as ExecutionPipeline/
      // ProjectPreparationService (Faz 3A) - anything thrown before the
      // Execution Pipeline even starts (capability check, asset/dependency
      // download outside prepare(), a missing render profile) still
      // reaches Laravel/logs with its real error code when it has one.
      const message =
        error instanceof RenderNodeError
          ? `[${error.code}] ${error.message}`
          : (error as Error).message;

      this.logger.error('İş işlenirken hata oluştu', {
        jobUuid,
        error: message,
        errorCode: error instanceof RenderNodeError ? error.code : null,
      });
      await this.resultForwarder.sendFailed(jobUuid, [message]).catch(() => {});
    } finally {
      // Community Render Asset Protection & Project Lifecycle Security
      // phase — runs regardless of success/failure/exception, exactly like
      // activeJobCount's own decrement right below it. A cleanup failure
      // is caught and logged here (never rethrown) so it can never turn an
      // already-reported job result into a different one, nor prevent
      // activeJobUuids from being released (which would wrongly protect a
      // finished job's stale workspace from ever being swept later).
      try {
        await this.workspaceService.deleteJobWorkspace(jobUuid);
      } catch (error) {
        this.logger.error('Job Workspace temizliği başarısız oldu', {
          jobUuid,
          event: 'render_workspace_cleanup_failed',
          error: (error as Error).message,
        });
      }

      this.activeJobUuids.delete(jobUuid);
      this.activeJobCount -= 1;
    }
  }
}
