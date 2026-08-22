/**
 * Target Laravel endpoint paths for each ApiClient method. None of these
 * exist on the Laravel side yet — kept as named constants (not inline
 * strings) so the real implementation and the mock stay in sync later.
 *
 * Job-scoped paths live under /api/render-jobs/*, never /api/render-projects/*:
 * progress, completion, and failure always belong to the RenderJob, not the
 * RenderProject it was claimed for.
 */
export const ApiEndpoints = {
  REGISTER: '/api/render-nodes/register',
  HEARTBEAT: '/api/render-nodes/heartbeat',
  SYSTEM_STATUS: '/api/render-nodes/system-status',
  /** Claiming an available job, not merely requesting one. */
  CLAIM_JOB: '/api/render-jobs/claim',
  jobProgress: (jobUuid: string): string => `/api/render-jobs/${jobUuid}/progress`,
  jobComplete: (jobUuid: string): string => `/api/render-jobs/${jobUuid}/complete`,
  jobFailed: (jobUuid: string): string => `/api/render-jobs/${jobUuid}/failed`,
  dependencyPackage: (renderTemplateUuid: string): string =>
    `/api/render-templates/${renderTemplateUuid}/dependencies`,
  /** Added in Phase 4 — the render template's currently-approved Project asset (.aep/.mogrt). */
  templateAsset: (templateUuid: string): string => `/api/render-templates/${templateUuid}/asset`,
} as const;
