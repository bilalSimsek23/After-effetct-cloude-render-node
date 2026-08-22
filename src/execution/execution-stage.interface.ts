import type { ExecutionContext } from './execution-context.js';
import type { ErrorCode } from '../errors/error-code.js';
import { RenderNodeError } from '../errors/render-node-error.js';

/**
 * A Stage's precondition failed. `code` is picked by the throw site to
 * reflect what's actually missing (PROJECT_*, VARIABLE_*, RENDER_*, ...)
 * — ExecutionStageError itself is generic across every Stage, but the
 * real failure category is always known at the call site, so it's always
 * required here rather than defaulted.
 */
export class ExecutionStageError extends RenderNodeError {
  constructor(
    public readonly stageName: string,
    code: ErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(code, `[${stageName}] ${message}`, context);
  }
}

/**
 * Every Stage in the Execution Pipeline implements this — nothing else.
 * A Stage never calls another Stage; it only reads/acts on the
 * ExecutionContext it's given and returns that same context. Failure is
 * always a thrown ExecutionStageError, never a status field on the return
 * value.
 */
export interface IExecutionStage {
  readonly name: string;
  execute(context: ExecutionContext): Promise<ExecutionContext>;
}
