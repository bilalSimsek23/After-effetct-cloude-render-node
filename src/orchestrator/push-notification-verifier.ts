import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RenderNodeConfig } from '../types/config.types.js';

export interface PushNotificationBody {
  schema?: string;
  version?: string;
  jobUuid?: string;
  claimUrl?: string;
  claimToken?: string;
  expiresAt?: string;
  signature?: string;
}

export interface VerifiedPushNotification {
  jobUuid: string;
  claimToken: string;
}

/**
 * Verifies a push notification's `signature` (see RenderNodePushClient.php)
 * before this node acts on it: `hash_hmac('sha256', "{jobUuid}|{claimUrl}|
 * {expiresAt}", apiSecret)`, hex-encoded. This is a second, independent
 * check from the node's own *outbound* HMAC auth on the claim call it
 * makes afterwards - it exists so a node never even attempts a claim based
 * on a forged or tampered notification.
 */
export function verifyPushNotification(
  body: PushNotificationBody,
  config: RenderNodeConfig,
): VerifiedPushNotification | null {
  const { jobUuid, claimUrl, claimToken, expiresAt, signature } = body;

  if (!jobUuid || !claimUrl || !claimToken || !expiresAt || !signature) {
    return null;
  }

  const expected = createHmac('sha256', config.apiSecret)
    .update(`${jobUuid}|${claimUrl}|${expiresAt}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  if (new Date(expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return { jobUuid, claimToken };
}
