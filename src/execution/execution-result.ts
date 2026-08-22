import type { RenderResultContract } from '../contracts/render-result.contract.js';

export const ExecutionResultStatus = {
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type ExecutionResultStatus =
  (typeof ExecutionResultStatus)[keyof typeof ExecutionResultStatus];

/**
 * What ExecutionPipeline.run() always returns — success or failure, never
 * a thrown error escaping the pipeline itself (a Stage throws; the
 * pipeline catches and reports here). `renderResult` is only null when the
 * pipeline failed before a result could be assembled.
 */
export interface ExecutionResult {
  status: ExecutionResultStatus;
  jobUuid: string;
  durationMs: number;
  renderResult: RenderResultContract | null;
  errors: string[];
}
