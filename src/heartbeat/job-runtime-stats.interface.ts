/**
 * The one piece of JobManager state HeartbeatService needs (running job
 * count, for the heartbeat payload). Defined here, on the consumer side,
 * so HeartbeatService depends on this narrow interface instead of the
 * full JobManager class.
 */
export interface JobRuntimeStats {
  getRunningJobCount(): number;
}
