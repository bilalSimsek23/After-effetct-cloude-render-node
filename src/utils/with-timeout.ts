export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`"${label}" operation did not complete within ${timeoutMs}ms.`);
    this.name = 'TimeoutError';
  }
}

/**
 * Shared timeout wrapper. Used by every Adobe bridge/engine operation that
 * talks to an external process (osascript, `open`, `defaults`), so timeout
 * handling lives in exactly one place.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolvePromise(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
