import { ExecutionResultStatus } from '../execution/execution-result.js';
import type { ExecutionResult } from '../execution/execution-result.js';
import type { ILaravelApiClient } from '../api/laravel-api.client.js';
import type { Logger } from '../types/log.types.js';

export interface IResultForwarder {
  send(jobUuid: string, result: ExecutionResult): Promise<void>;
  sendFailed(jobUuid: string, errors: string[]): Promise<void>;
}

/**
 * The only place an ExecutionResult reaches Laravel. Execution Pipeline
 * itself never talks to the API (see Phase 5) — it only returns a result;
 * JobPoller hands that result to this class, which decides COMPLETED vs
 * FAILED and sends the matching real Contract.
 */
export class ResultForwarder implements IResultForwarder {
  constructor(
    private readonly laravelApiClient: ILaravelApiClient,
    private readonly logger: Logger,
  ) {}

  async send(jobUuid: string, result: ExecutionResult): Promise<void> {
    if (result.status === ExecutionResultStatus.COMPLETED && result.renderResult) {
      await this.laravelApiClient.sendJobCompleted(jobUuid, result.renderResult);
      this.logger.info("Result forwarded to Laravel (COMPLETED)", { jobUuid });
      return;
    }

    await this.sendFailed(jobUuid, result.errors);
  }

  async sendFailed(jobUuid: string, errors: string[]): Promise<void> {
    await this.laravelApiClient.sendJobFailed(jobUuid, errors);
    this.logger.warn("Result forwarded to Laravel (FAILED)", { jobUuid, errors });
  }
}
