import { JobState } from './job-state.types.js';
import type { JobStateMachine } from './job-state-machine.js';
import type { IRenderBrokerService } from './render-broker.service.js';
import type { Logger } from '../types/log.types.js';

export interface IExecutionCoordinator {
  advance(jobUuid: string, toState: JobState): void;
  completeJob(jobUuid: string, templateUuid: string): void;
  failJob(jobUuid: string): Promise<void>;
}

/**
 * Drives a claimed job through PREPARING → EXECUTING → UPLOADING →
 * COMPLETED (or → FAILED). In a real system this would be fed by a node's
 * heartbeat/progress reports; in this simulation the check script plays
 * that role directly. Every transition still goes through JobStateMachine
 * — this class never sets state itself, only asks the machine to do it.
 */
export class ExecutionCoordinator implements IExecutionCoordinator {
  constructor(
    private readonly jobStateMachine: JobStateMachine,
    private readonly renderBrokerService: IRenderBrokerService,
    private readonly logger: Logger,
  ) {}

  advance(jobUuid: string, toState: JobState): void {
    this.jobStateMachine.transition(jobUuid, toState);
    this.logger.debug('Execution ilerledi', { jobUuid, toState });
  }

  completeJob(jobUuid: string, templateUuid: string): void {
    this.jobStateMachine.transition(jobUuid, JobState.COMPLETED);
    this.renderBrokerService.reportJobCompleted(jobUuid, templateUuid);
    this.logger.info('Job tamamlandı', { jobUuid, templateUuid });
  }

  async failJob(jobUuid: string): Promise<void> {
    this.jobStateMachine.transition(jobUuid, JobState.FAILED);
    await this.renderBrokerService.reportJobFailed(jobUuid);
    this.logger.warn('Job başarısız oldu', { jobUuid });
  }
}
