import { JobState, VALID_JOB_STATE_TRANSITIONS } from './job-state.types.js';
import type { Logger } from '../types/log.types.js';

export class InvalidJobStateTransitionError extends Error {
  constructor(jobUuid: string, from: JobState, to: JobState) {
    super(`Geçersiz Job State geçişi: ${from} → ${to} (jobUuid=${jobUuid})`);
    this.name = 'InvalidJobStateTransitionError';
  }
}

export class UnknownJobError extends Error {
  constructor(jobUuid: string) {
    super(`Bilinmeyen jobUuid: ${jobUuid}`);
    this.name = 'UnknownJobError';
  }
}

/**
 * The single place a Render Job's lifecycle state actually changes. No
 * other service in this module mutates a job's state directly — they all
 * call transition() and let it validate against VALID_JOB_STATE_TRANSITIONS.
 * Not a singleton: one instance is built by the composition root and
 * shared via constructor injection, same as everything else in this
 * codebase.
 */
export class JobStateMachine {
  private readonly states = new Map<string, JobState>();

  constructor(private readonly logger: Logger) {}

  /** Registers a brand-new job at QUEUED — the only state a job may start its life in. */
  register(jobUuid: string): void {
    this.states.set(jobUuid, JobState.QUEUED);
    this.logger.debug('Job State kaydedildi', { jobUuid, state: JobState.QUEUED });
  }

  getState(jobUuid: string): JobState {
    const state = this.states.get(jobUuid);
    if (!state) {
      throw new UnknownJobError(jobUuid);
    }
    return state;
  }

  transition(jobUuid: string, to: JobState): JobState {
    const from = this.getState(jobUuid);
    const allowed = VALID_JOB_STATE_TRANSITIONS[from];

    if (!allowed.includes(to)) {
      throw new InvalidJobStateTransitionError(jobUuid, from, to);
    }

    this.states.set(jobUuid, to);
    this.logger.debug('Job State geçişi', { jobUuid, from, to });

    return to;
  }

  canTransition(jobUuid: string, to: JobState): boolean {
    const from = this.states.get(jobUuid);
    if (!from) {
      return false;
    }
    return VALID_JOB_STATE_TRANSITIONS[from].includes(to);
  }
}
