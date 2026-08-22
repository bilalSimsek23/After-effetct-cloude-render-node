import type { JobClaimContract } from '../contracts/job-claim.contract.js';
import type { JobStateMachine } from './job-state-machine.js';
import type { IRenderBrokerService } from './render-broker.service.js';
import type { SchedulingRequirement } from './scheduling-requirement.types.js';
import type { Logger } from '../types/log.types.js';

export interface IJobScheduler {
  submit(jobUuid: string, requirement: SchedulingRequirement): JobClaimContract;
}

/**
 * The thin front door: Render Job → JobScheduler → RenderBrokerService →
 * node seç → lease oluştur → claim. JobManager no longer claims jobs on
 * its own — this is the one place a job enters the scheduling flow, and
 * it contains zero node-selection logic itself, all of which lives in
 * RenderBrokerService.
 */
export class JobScheduler implements IJobScheduler {
  constructor(
    private readonly jobStateMachine: JobStateMachine,
    private readonly renderBrokerService: IRenderBrokerService,
    private readonly logger: Logger,
  ) {}

  submit(jobUuid: string, requirement: SchedulingRequirement): JobClaimContract {
    this.jobStateMachine.register(jobUuid);
    this.logger.info('Job kuyruğa alındı', { jobUuid, templateUuid: requirement.templateUuid });

    return this.renderBrokerService.scheduleJob(jobUuid, requirement);
  }
}
