import type { IApiClient } from '../api/api-client.interface.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import { ContractName } from '../contracts/registry/contract-name.js';
import {
  createRenderProgressContract,
  RenderProgressStatus,
} from '../contracts/render-progress.contract.js';
import type { Logger } from '../types/log.types.js';

/**
 * Every step the Execution Pipeline reports progress for — finer-grained
 * than RenderProgressContract's own `status` enum, so each one maps onto
 * one of RenderProgressContract's 7 statuses via STAGE_PROGRESS below.
 * `currentStep` (a free string on the Contract) carries this finer name.
 */
export const ExecutionStageName = {
  QUEUED: 'QUEUED',
  PREPARING: 'PREPARING',
  /** Faz 3A — Project Preparation Pipeline's own granular sub-stages, all still bucketed under RenderProgressContract's PREPARING status (see STAGE_PROGRESS below); `currentStep` is what actually carries the finer name to Laravel. */
  PREPARING_WORKSPACE: 'PREPARING_WORKSPACE',
  DOWNLOADING_PROJECT: 'DOWNLOADING_PROJECT',
  DOWNLOADING_DEPENDENCIES: 'DOWNLOADING_DEPENDENCIES',
  VALIDATING_DEPENDENCIES: 'VALIDATING_DEPENDENCIES',
  /** Faz 8C — downloading buyer-uploaded IMAGE/VIDEO/AUDIO variable replacement assets, still bucketed under PREPARING. */
  DOWNLOADING_VARIABLE_ASSETS: 'DOWNLOADING_VARIABLE_ASSETS',
  LOADING_PROJECT: 'LOADING_PROJECT',
  APPLYING_VARIABLES: 'APPLYING_VARIABLES',
  SAVING_PROJECT: 'SAVING_PROJECT',
  QUEUEING_RENDER: 'QUEUEING_RENDER',
  WAITING_RENDER: 'WAITING_RENDER',
  COLLECTING_OUTPUT: 'COLLECTING_OUTPUT',
  UPLOADING_OUTPUT: 'UPLOADING_OUTPUT',
  CLEANING_UP: 'CLEANING_UP',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type ExecutionStageName = (typeof ExecutionStageName)[keyof typeof ExecutionStageName];

export interface StageProgress {
  status: RenderProgressStatus;
  percentage: number;
}

/** Exported so ProgressForwarder (Phase 7) can reuse the exact same stage→status/percentage mapping without duplicating it. */
export const STAGE_PROGRESS: Record<ExecutionStageName, StageProgress> = {
  [ExecutionStageName.QUEUED]: { status: RenderProgressStatus.QUEUED, percentage: 0 },
  [ExecutionStageName.PREPARING]: { status: RenderProgressStatus.PREPARING, percentage: 5 },
  [ExecutionStageName.PREPARING_WORKSPACE]: { status: RenderProgressStatus.PREPARING, percentage: 7 },
  [ExecutionStageName.DOWNLOADING_PROJECT]: { status: RenderProgressStatus.PREPARING, percentage: 9 },
  [ExecutionStageName.DOWNLOADING_DEPENDENCIES]: {
    status: RenderProgressStatus.PREPARING,
    percentage: 11,
  },
  [ExecutionStageName.VALIDATING_DEPENDENCIES]: {
    status: RenderProgressStatus.PREPARING,
    percentage: 13,
  },
  [ExecutionStageName.DOWNLOADING_VARIABLE_ASSETS]: {
    status: RenderProgressStatus.PREPARING,
    percentage: 14,
  },
  [ExecutionStageName.LOADING_PROJECT]: { status: RenderProgressStatus.PREPARING, percentage: 15 },
  [ExecutionStageName.APPLYING_VARIABLES]: {
    status: RenderProgressStatus.PREPARING,
    percentage: 25,
  },
  [ExecutionStageName.SAVING_PROJECT]: { status: RenderProgressStatus.PREPARING, percentage: 35 },
  [ExecutionStageName.QUEUEING_RENDER]: { status: RenderProgressStatus.RENDERING, percentage: 45 },
  [ExecutionStageName.WAITING_RENDER]: { status: RenderProgressStatus.RENDERING, percentage: 70 },
  [ExecutionStageName.COLLECTING_OUTPUT]: { status: RenderProgressStatus.ENCODING, percentage: 85 },
  [ExecutionStageName.UPLOADING_OUTPUT]: { status: RenderProgressStatus.UPLOADING, percentage: 92 },
  [ExecutionStageName.CLEANING_UP]: { status: RenderProgressStatus.UPLOADING, percentage: 97 },
  [ExecutionStageName.COMPLETED]: { status: RenderProgressStatus.COMPLETED, percentage: 100 },
  [ExecutionStageName.FAILED]: { status: RenderProgressStatus.FAILED, percentage: 100 },
};

export interface IProgressService {
  stage(
    jobUuid: string,
    stageName: ExecutionStageName,
    estimatedRemainingSeconds?: number | null,
  ): Promise<void>;
}

/**
 * The only place Execution Pipeline progress reaches the API through.
 * ExecutionPipeline/Stages call `stage()` with a semantic name and never
 * see an API detail; this service builds and validates a real
 * RenderProgressContract via the Contract Registry, then — since
 * IApiClient.jobProgress() hasn't been migrated to accept a full Contract
 * yet — translates it down to the existing JobProgressPayload shape for
 * the actual (mock) call.
 */
export class ProgressService implements IProgressService {
  constructor(
    private readonly apiClient: IApiClient,
    private readonly contractRegistry: ContractRegistry,
    private readonly logger: Logger,
  ) {}

  async stage(
    jobUuid: string,
    stageName: ExecutionStageName,
    estimatedRemainingSeconds: number | null = null,
  ): Promise<void> {
    const mapping = STAGE_PROGRESS[stageName];
    const version = this.contractRegistry.getCurrentVersion(ContractName.RENDER_PROGRESS);

    const progress = createRenderProgressContract(
      {
        status: mapping.status,
        percentage: mapping.percentage,
        currentStep: stageName,
        estimatedRemainingSeconds,
      },
      version,
    );

    this.contractRegistry.validate(ContractName.RENDER_PROGRESS, progress);

    await this.apiClient.jobProgress(jobUuid, {
      progressPercent: progress.percentage,
      message: progress.currentStep,
    });

    this.logger.info('İlerleme raporlandı', {
      jobUuid,
      stageName,
      status: progress.status,
      percentage: progress.percentage,
    });
  }
}
