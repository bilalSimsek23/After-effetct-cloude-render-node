import { JobState } from './job-state.types.js';
import type { JobStateMachine } from './job-state-machine.js';
import type { ILeaseManager } from './lease-manager.js';
import type { Logger } from '../types/log.types.js';

export interface IDeadJobRecoveryService {
  recoverNode(nodeUuid: string, jobUuids: string[]): string[];
}

/**
 * Reacts to a node going OFFLINE (HeartbeatWatcher's job to detect that,
 * not this service's): every job leased to that node has its lease force-
 * released and its state moved EXPIRED → QUEUED — never straight back to
 * CLAIMED/EXECUTING, since a fresh node must go through the normal
 * scheduling flow again. Doesn't touch the job's Job Workspace at all
 * ("Workspace korunur" per spec) — there is nothing for a central service
 * to delete; a real node's workspace is untouched by design (see Phase 5's
 * CleanupStage, which never deletes it either) and Project Preparation
 * will simply re-run on whichever node picks the job up next.
 *
 * Doesn't reschedule the recovered jobs itself — it only returns which
 * ones are now QUEUED; RenderBrokerService (which alone knows each job's
 * SchedulingRequirement) decides what happens next.
 */
export class DeadJobRecoveryService implements IDeadJobRecoveryService {
  constructor(
    private readonly jobStateMachine: JobStateMachine,
    private readonly leaseManager: ILeaseManager,
    private readonly logger: Logger,
  ) {}

  recoverNode(nodeUuid: string, jobUuids: string[]): string[] {
    const recovered: string[] = [];

    for (const jobUuid of jobUuids) {
      const lease = this.leaseManager.getLeaseForJob(jobUuid);
      if (lease) {
        this.leaseManager.forceRelease(lease.leaseId);
      }

      try {
        this.jobStateMachine.transition(jobUuid, JobState.EXPIRED);
        this.jobStateMachine.transition(jobUuid, JobState.QUEUED);
        recovered.push(jobUuid);
        this.logger.warn('Dead Job Recovery: job re-queued', { jobUuid, nodeUuid });
      } catch (error) {
        this.logger.error('Dead Job Recovery failed (invalid state transition)', {
          jobUuid,
          nodeUuid,
          error: (error as Error).message,
        });
      }
    }

    return recovered;
  }
}
