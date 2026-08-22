export const JobState = {
  QUEUED: 'QUEUED',
  SCHEDULED: 'SCHEDULED',
  LEASED: 'LEASED',
  CLAIMED: 'CLAIMED',
  PREPARING: 'PREPARING',
  EXECUTING: 'EXECUTING',
  UPLOADING: 'UPLOADING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  RETRYING: 'RETRYING',
} as const;

export type JobState = (typeof JobState)[keyof typeof JobState];

/**
 * The only valid next states from each state. Terminal states (COMPLETED,
 * CANCELLED) map to an empty array. Nothing outside JobStateMachine reads
 * this table directly — it's the single source of truth for what's
 * allowed, which is what "State geçişleri merkezi olarak doğrulanacaktır"
 * means in practice.
 *
 * PAUSED/RESUMED are not modeled yet (spec explicitly defers the real
 * implementation to a later phase) — but since every transition is
 * table-driven rather than hardcoded per-service, adding a PAUSED state
 * later only means adding rows here, not touching every service that
 * moves a job through its lifecycle.
 */
export const VALID_JOB_STATE_TRANSITIONS: Record<JobState, JobState[]> = {
  [JobState.QUEUED]: [JobState.SCHEDULED, JobState.CANCELLED],
  [JobState.SCHEDULED]: [JobState.LEASED, JobState.CANCELLED, JobState.FAILED],
  [JobState.LEASED]: [JobState.CLAIMED, JobState.EXPIRED, JobState.CANCELLED],
  [JobState.CLAIMED]: [JobState.PREPARING, JobState.EXPIRED, JobState.CANCELLED],
  [JobState.PREPARING]: [JobState.EXECUTING, JobState.FAILED, JobState.EXPIRED, JobState.CANCELLED],
  [JobState.EXECUTING]: [JobState.UPLOADING, JobState.FAILED, JobState.EXPIRED, JobState.CANCELLED],
  [JobState.UPLOADING]: [JobState.COMPLETED, JobState.FAILED],
  [JobState.COMPLETED]: [],
  [JobState.FAILED]: [JobState.RETRYING, JobState.CANCELLED],
  [JobState.CANCELLED]: [],
  [JobState.EXPIRED]: [JobState.RETRYING, JobState.QUEUED, JobState.CANCELLED],
  [JobState.RETRYING]: [JobState.SCHEDULED, JobState.CANCELLED],
};
