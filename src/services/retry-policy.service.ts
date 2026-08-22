import { retryWithBackoff } from '../utils/retry.js';
import type { Logger } from '../types/log.types.js';

/** Every operation whose retry behavior this service governs — never a hardcoded {retries, delay} at a call site. */
export const RetryOperation = {
  /** Renamed from MEDIA_ENCODER_QUEUE in Faz 8B — rendering goes through AfterEffectsRenderEngine's own render queue, not Media Encoder. */
  RENDER_QUEUE: 'render-queue',
  UPLOAD: 'upload',
  ADOBE_JSX: 'adobe-jsx',
  LARAVEL_API: 'laravel-api',
  /** Added in Phase 6 — retrying a single node-selection/lease-creation attempt during a job retry. */
  JOB_SCHEDULING: 'job-scheduling',
} as const;

export type RetryOperation = (typeof RetryOperation)[keyof typeof RetryOperation];

interface RetryPolicyConfig {
  retries: number;
  initialDelayMs: number;
}

const POLICIES: Record<RetryOperation, RetryPolicyConfig> = {
  [RetryOperation.RENDER_QUEUE]: { retries: 3, initialDelayMs: 2000 },
  [RetryOperation.UPLOAD]: { retries: 3, initialDelayMs: 1000 },
  [RetryOperation.ADOBE_JSX]: { retries: 2, initialDelayMs: 1500 },
  [RetryOperation.LARAVEL_API]: { retries: 2, initialDelayMs: 1000 },
  [RetryOperation.JOB_SCHEDULING]: { retries: 2, initialDelayMs: 500 },
};

export interface IRetryPolicyService {
  execute<T>(operation: RetryOperation, fn: () => Promise<T>): Promise<T>;
}

/**
 * The single place retry count/delay/backoff is decided for every kind of
 * flaky operation the Execution Pipeline depends on. Stages never build
 * their own retry loop — they call `retryPolicy.execute(operation, fn)`
 * and this service picks the policy, reusing the existing, tested
 * `retryWithBackoff()` utility rather than duplicating it.
 */
export class RetryPolicyService implements IRetryPolicyService {
  constructor(private readonly logger: Logger) {}

  execute<T>(operation: RetryOperation, fn: () => Promise<T>): Promise<T> {
    const policy = POLICIES[operation];

    return retryWithBackoff(fn, {
      retries: policy.retries,
      initialDelayMs: policy.initialDelayMs,
      logger: this.logger,
      label: operation,
    });
  }
}
