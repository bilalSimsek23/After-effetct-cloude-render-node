import { extname, resolve } from 'node:path';
import type { RenderJobContract } from '../contracts/render-job.contract.js';
import type {
  RenderNodeDownloadableAsset,
  RenderNodeTemplateManifestSource,
} from '../types/render-node-job-payload.types.js';
import type { RenderProfileCode } from '../contracts/render-profile.contract.js';
import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { CapabilityRegistry } from '../capabilities/capability-registry.js';
import type { AdobeWorkspaceService, JobWorkspacePaths } from '../adobe/runtime/adobe-workspace.service.js';
import type { IDependencyPackageService } from '../adobe/dependency/dependency-package.service.js';
import { DependencyVerificationStatus } from '../adobe/dependency/dependency-package.types.js';
import type { ITemplateDownloadService } from './template-download.service.js';
import type { IProjectExtractor } from './project-extractor.js';
import type { IProjectValidator } from './project-validator.js';
import type { IVariableFileBuilder } from './variable-file-builder.js';
import { mapJobWorkspaceToContract } from './workspace-contract.mapper.js';
import { PreparedProjectStatus } from './prepared-project.types.js';
import type { PreparedProject } from './prepared-project.types.js';
import { RenderNodeError } from '../errors/render-node-error.js';
import { ErrorCode } from '../errors/error-code.js';
import { ExecutionStageName } from '../services/progress.service.js';
import type { IProgressService } from '../services/progress.service.js';
import type { Logger } from '../types/log.types.js';
import type { ManifestContract } from '../contracts/manifest.contract.js';
import type { ILaravelApiClient } from '../api/laravel-api.client.js';

const MEDIA_VARIABLE_TYPES = new Set(['IMAGE', 'VIDEO', 'AUDIO']);

/** Variable keys can contain spaces/punctuation (they mirror AE layer/composition names) — not safe as-is in a filename. */
function sanitizeAssetFileName(variableKey: string): string {
  return variableKey.replace(/[^A-Za-z0-9_-]/g, '_');
}

export class NodeNotCapableError extends Error {
  constructor(engine: string, renderProfile: string) {
    super(
      `This node does not meet the "${engine}" engine / "${renderProfile}" render profile requirement.`,
    );
    this.name = 'NodeNotCapableError';
  }
}

export interface ProjectPreparationInput {
  renderJob: RenderJobContract;
  engine: string;
  capabilityReport: CapabilityReportContract;
  /** Stand-in for "already downloaded" — actually transferring bytes over HTTP is out of scope, same as Phase 3. */
  localTemplateAssetFilePath: string;
  /** From the claim response's `projectAsset.checksumSha256` — verified against the downloaded file's real hash, when Laravel supplied one. */
  expectedProjectAssetHash: string | null;
  /** The claim response's `template` blob — the only manifest source; no manifest.json ships inside the downloaded project asset. */
  templateManifestSource: RenderNodeTemplateManifestSource;
  localDependencyPackageZipPath: string;
  dependencyPackageVersion: number;
  /** The claim response's `variableAssets` map — one entry per IMAGE/VIDEO/AUDIO variable the buyer actually uploaded a replacement for. */
  variableAssets: Record<string, RenderNodeDownloadableAsset>;
}

export interface IProjectPreparationService {
  prepare(input: ProjectPreparationInput): Promise<PreparedProject>;
}

/**
 * Pure orchestrator for the Project Preparation Pipeline, in exactly this
 * order: Capability Registry pre-check → Job Workspace → Template
 * download → Dependency Package install → Project (.aep) extraction →
 * Manifest validation → variables.json. A future Render Engine consumes
 * only the result's projectFilePath + variablesFilePath and does zero
 * preparation work of its own.
 */
export class ProjectPreparationService implements IProjectPreparationService {
  constructor(
    private readonly workspaceService: AdobeWorkspaceService,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly laravelApiClient: ILaravelApiClient,
    private readonly templateDownloadService: ITemplateDownloadService,
    private readonly dependencyPackageService: IDependencyPackageService,
    private readonly projectExtractor: IProjectExtractor,
    private readonly projectValidator: IProjectValidator,
    private readonly variableFileBuilder: IVariableFileBuilder,
    private readonly progressService: IProgressService,
    private readonly logger: Logger,
  ) {}

  async prepare(input: ProjectPreparationInput): Promise<PreparedProject> {
    const { renderJob } = input;
    const renderProfile = renderJob.renderType as unknown as RenderProfileCode;

    // Capacity was already checked live, correctly, before this job was
    // claimed (JobProcessor.handleAssignedJob) — re-checking it here against
    // the CapabilityRegistry's cached report (refreshed only every 5
    // minutes) can spuriously reject an already-claimed, already-in-flight
    // job. Only re-validate what's still worth re-checking post-claim:
    // engine/render-profile/font/plugin support.
    if (
      !this.capabilityRegistry.supportsStatic(input.capabilityReport, {
        engine: input.engine,
        renderProfile,
      })
    ) {
      throw new NodeNotCapableError(input.engine, renderProfile);
    }

    // Best-effort workspace-path computation for the FAILED-return path
    // below, in case createJobWorkspace() itself throws (e.g. disk full,
    // permission denied) — getJobWorkspacePaths() only computes paths, it
    // never touches the filesystem, so it can't itself fail here.
    let workspace = mapJobWorkspaceToContract(
      this.workspaceService.getJobWorkspacePaths(renderJob.jobUuid),
    );

    try {
      await this.progressService.stage(renderJob.jobUuid, ExecutionStageName.PREPARING_WORKSPACE);
      const jobWorkspace = await this.wrapStep(
        () => this.workspaceService.createJobWorkspace(renderJob.jobUuid),
        ErrorCode.EXECUTION_WORKSPACE_FAILED,
        'Failed to create job workspace',
        renderJob.jobUuid,
      );
      workspace = mapJobWorkspaceToContract(jobWorkspace);

      await this.progressService.stage(renderJob.jobUuid, ExecutionStageName.DOWNLOADING_PROJECT);
      const downloadResult = await this.wrapStep(
        () =>
          this.templateDownloadService.download(
            renderJob.templateUuid,
            input.localTemplateAssetFilePath,
            jobWorkspace,
            input.expectedProjectAssetHash,
          ),
        ErrorCode.PROJECT_DOWNLOAD_FAILED,
        'Project (template asset) download/preparation failed',
        renderJob.jobUuid,
      );

      await this.progressService.stage(
        renderJob.jobUuid,
        ExecutionStageName.DOWNLOADING_DEPENDENCIES,
      );
      const dependencyReport = await this.wrapStep(
        () =>
          this.dependencyPackageService.ensureInstalled(
            renderJob.templateUuid,
            input.dependencyPackageVersion,
            input.localDependencyPackageZipPath,
            jobWorkspace,
          ),
        ErrorCode.DEPENDENCY_DOWNLOAD_FAILED,
        'Dependency package download/installation failed',
        renderJob.jobUuid,
      );

      await this.progressService.stage(
        renderJob.jobUuid,
        ExecutionStageName.VALIDATING_DEPENDENCIES,
      );
      if (dependencyReport.verification.status !== DependencyVerificationStatus.READY) {
        throw new RenderNodeError(
          ErrorCode.DEPENDENCY_VALIDATION_FAILED,
          `Dependency package validation failed: ${JSON.stringify(dependencyReport.verification)}`,
          { jobUuid: renderJob.jobUuid, verification: dependencyReport.verification },
        );
      }

      const extraction = await this.wrapStep(
        () => this.projectExtractor.extract(downloadResult.projectFilePath, jobWorkspace),
        ErrorCode.PROJECT_DOWNLOAD_FAILED,
        'Failed to open project archive (extract)',
        renderJob.jobUuid,
      );

      const validation = await this.projectValidator.validate(
        input.templateManifestSource,
        jobWorkspace,
      );

      await this.progressService.stage(
        renderJob.jobUuid,
        ExecutionStageName.DOWNLOADING_VARIABLE_ASSETS,
      );
      const mediaAssetLocalPaths = await this.downloadVariableAssets(
        input.variableAssets,
        validation.manifest,
        jobWorkspace,
        renderJob.jobUuid,
      );

      const variableResult = await this.variableFileBuilder.build(
        renderJob,
        validation.manifest,
        jobWorkspace,
        mediaAssetLocalPaths,
      );

      this.logger.info('Project Preparation Pipeline completed', {
        jobUuid: renderJob.jobUuid,
        projectFilePath: extraction.projectFilePath,
        variablesFilePath: variableResult.variablesFilePath,
      });

      return {
        jobUuid: renderJob.jobUuid,
        status: PreparedProjectStatus.READY,
        projectFilePath: extraction.projectFilePath,
        variablesFilePath: variableResult.variablesFilePath,
        workspace,
        errors: [],
      };
    } catch (error) {
      // Same "[CODE] message" convention as ExecutionPipeline.run() -
      // PreparedProject.errors stays a plain string[] (no Contract shape
      // change), but a RenderNodeError's code still survives inside the
      // string for anything downstream that wants to classify the failure.
      const message =
        error instanceof RenderNodeError
          ? `[${error.code}] ${error.message}`
          : (error as Error).message;

      this.logger.error('Project Preparation Pipeline failed', {
        jobUuid: renderJob.jobUuid,
        error: message,
        errorCode: error instanceof RenderNodeError ? error.code : null,
      });

      return {
        jobUuid: renderJob.jobUuid,
        status: PreparedProjectStatus.FAILED,
        projectFilePath: null,
        variablesFilePath: null,
        workspace,
        errors: [message],
      };
    }
  }

  /**
   * Downloads each buyer-uploaded IMAGE/VIDEO/AUDIO variable replacement
   * asset into jobWorkspace.assets, keyed by variable key so
   * VariableFileBuilder can prefer a local path over the raw Laravel
   * storage-path string that ships in renderJob.variables. Only manifest
   * variables of a media type AND present in input.variableAssets are
   * downloaded — a media variable the buyer left unset has no entry in
   * either map and is silently skipped (the original embedded asset stays).
   */
  private async downloadVariableAssets(
    variableAssets: Record<string, RenderNodeDownloadableAsset>,
    manifest: ManifestContract,
    jobWorkspace: JobWorkspacePaths,
    jobUuid: string,
  ): Promise<Record<string, string>> {
    const mediaAssetLocalPaths: Record<string, string> = {};

    for (const variable of manifest.variables) {
      if (!MEDIA_VARIABLE_TYPES.has(variable.type.toUpperCase())) {
        continue;
      }

      const asset = variableAssets[variable.key];
      if (!asset) {
        continue;
      }

      const extension = extname(asset.originalFilename);
      const destinationPath = resolve(jobWorkspace.assets, `${sanitizeAssetFileName(variable.key)}${extension}`);

      await this.wrapStep(
        () => this.laravelApiClient.downloadAsset(asset.downloadUrl, destinationPath),
        ErrorCode.VARIABLE_ASSET_DOWNLOAD_FAILED,
        `Failed to download variable asset: ${variable.key}`,
        jobUuid,
      );

      mediaAssetLocalPaths[variable.key] = destinationPath;
    }

    return mediaAssetLocalPaths;
  }

  /**
   * Runs one preparation step; if it throws anything other than an
   * already-coded RenderNodeError, wraps it as one with the code that
   * matches this step specifically (a raw fs/network error from a
   * dependency service carries no code of its own otherwise).
   */
  private async wrapStep<T>(
    step: () => Promise<T>,
    code: ErrorCode,
    message: string,
    jobUuid: string,
  ): Promise<T> {
    try {
      return await step();
    } catch (error) {
      if (error instanceof RenderNodeError) {
        throw error;
      }
      throw new RenderNodeError(code, `${message}: ${(error as Error).message}`, { jobUuid });
    }
  }
}
