import type { IProgressService, ExecutionStageName } from '../services/progress.service.js';
import { STAGE_PROGRESS } from '../services/progress.service.js';
import { createRenderProgressContract } from '../contracts/render-progress.contract.js';
import { ContractName } from '../contracts/registry/contract-name.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import type { ILaravelApiClient } from '../api/laravel-api.client.js';
import type { Logger } from '../types/log.types.js';

/**
 * The real, production implementation of Phase 5's IProgressService —
 * Execution Pipeline / Stages call `progress.stage(...)` exactly as they
 * already did in Phase 5 and never know the difference. Unlike the old
 * ProgressService (Phase 5, which had to down-translate to the pre-Contract
 * JobProgressPayload because the mock ApiClient didn't accept a full
 * Contract), this forwards the real, validated RenderProgressContract
 * straight through — ILaravelApiClient.sendJobProgress() takes the Contract
 * directly.
 */
export class ProgressForwarder implements IProgressService {
  constructor(
    private readonly laravelApiClient: ILaravelApiClient,
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

    await this.laravelApiClient.sendJobProgress(jobUuid, progress);

    this.logger.info("Progress forwarded to Laravel", {
      jobUuid,
      stageName,
      status: progress.status,
      percentage: progress.percentage,
    });
  }
}
