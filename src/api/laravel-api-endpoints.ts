/**
 * Endpoint paths for the real, HMAC-authenticated Laravel API (Cloud
 * Render Platform Phase 2) — deliberately separate from api-endpoints.ts
 * (the older, pre-Phase-2 mock ApiClient's paths), which stays untouched
 * and keeps serving every existing check script/service that still
 * depends on IApiClient's original DTOs but is not part of the real
 * production orchestrator flow.
 *
 * All paths carry an explicit `/api` prefix (matching api-endpoints.ts's
 * own convention) - `config.server` is the bare origin (e.g.
 * "https://motioncurate.com"), never including `/api` itself, since
 * Laravel's own `routes/api.php` is mounted under that prefix by the
 * framework (bootstrap/app.php's withRouting(api: ...)).
 *
 * There is no self-service login or node-registration endpoint on Laravel
 * (see AuthService's docblock) - LOGIN/REGISTER_NODE were removed rather
 * than pointed at real paths, since no such paths exist.
 */
export const LaravelApiEndpoints = {
  NODE_HEARTBEAT: '/api/render-nodes/heartbeat',
  /** Render Telemetry & Reliability Foundation — was missing entirely; CapabilityLoop only logged a detected change until now. */
  NODE_CAPABILITY_REPORT: '/api/render-nodes/capability-report',
  claimJob: (jobUuid: string): string => `/api/render-nodes/render-jobs/${jobUuid}/claim`,
  declineJob: (jobUuid: string): string => `/api/render-nodes/render-jobs/${jobUuid}/decline`,
  jobPayload: (jobUuid: string): string => `/api/render-nodes/render-jobs/${jobUuid}/payload`,
  jobOutput: (jobUuid: string): string => `/api/render-nodes/render-jobs/${jobUuid}/output`,
  jobProgress: (jobUuid: string): string => `/api/jobs/${jobUuid}/progress`,
  jobCompleted: (jobUuid: string): string => `/api/jobs/${jobUuid}/completed`,
  jobFailed: (jobUuid: string): string => `/api/jobs/${jobUuid}/failed`,
} as const;
