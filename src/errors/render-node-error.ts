import type { ErrorCode } from './error-code.js';

/**
 * Base class every real Render Node error extends (Faz 8B). Exposes
 * `code` (a stable ErrorCode, never a string to match on) and an optional
 * `context` bag with whatever structured detail the throw site already
 * had at hand (jobUuid, path, key — never a re-derivation, always the
 * real values already in scope). `name` stays each subclass's own
 * (`RenderFailedError`, `UploadError`, ...) via `new.target`, so existing
 * `error.name`/`instanceof` checks are unaffected by this change.
 */
export class RenderNodeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
