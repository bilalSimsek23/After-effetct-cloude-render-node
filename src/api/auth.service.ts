import { createHmac, randomUUID } from 'node:crypto';
import type { RenderNodeConfig } from '../types/config.types.js';

export interface IAuthService {
  /**
   * Builds the X-Node-* header set for one outbound request. `rawBody` must
   * be the *exact* bytes that will be sent as the request body (or '' for
   * a GET/bodyless request) - Laravel's RenderNodeAuthenticator recomputes
   * the signature over `{timestamp}|{nonce}|{rawBody}` using the node's own
   * api_secret, so signing anything other than the literal bytes on the
   * wire (e.g. a re-serialized version of the same object) will not verify.
   * Accepts a Buffer for binary bodies (e.g. an uploaded render output) -
   * concatenating a Buffer into a template string would corrupt it, so
   * those bytes are hashed directly instead of being coerced to a string.
   */
  getAuthHeaders(rawBody: string | Buffer): Record<string, string>;
}

/**
 * The single place Render Node ↔ Laravel authentication is handled. Laravel
 * has no self-service login/token endpoint - a node's identity (nodeUuid)
 * and shared secret (apiSecret) are provisioned once, out of band, by an
 * admin running `php artisan cloud-render:register-render-node` and pasted
 * into this node's config. Every request is authenticated independently via
 * an HMAC-SHA256 signature over that request's own body (see
 * RenderNodeAuthenticator.php) - there is no session/token to refresh.
 */
export class AuthService implements IAuthService {
  constructor(private readonly config: RenderNodeConfig) {}

  getAuthHeaders(rawBody: string | Buffer): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const signature = createHmac('sha256', this.config.apiSecret)
      .update(`${timestamp}|${nonce}|`)
      .update(rawBody)
      .digest('hex');

    return {
      'X-Node-Uuid': this.config.nodeUuid,
      'X-Node-Timestamp': timestamp,
      'X-Node-Nonce': nonce,
      'X-Node-Signature': signature,
    };
  }
}
