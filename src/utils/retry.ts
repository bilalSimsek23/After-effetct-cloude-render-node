import { sleep } from './sleep.js';
import type { Logger } from '../types/log.types.js';

export interface RetryOptions {
  /** Number of retry attempts after the first failed try. */
  retries: number;
  initialDelayMs: number;
  logger: Logger;
  /** Short human-readable name of the operation, used in log lines. */
  label: string;
}

/**
 * Runs fn(), retrying with exponential backoff on failure. Throws the last
 * error once retries are exhausted — callers are still expected to catch
 * it so a single failed operation never crashes the process.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  let delayMs = options.initialDelayMs;

  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;

      if (attempt > options.retries) {
        throw error;
      }

      options.logger.warn(
        `${options.label} failed, retrying (${attempt}/${options.retries})`,
        { error: (error as Error).message },
      );

      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}
