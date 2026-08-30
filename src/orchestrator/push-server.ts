import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { verifyPushNotification } from './push-notification-verifier.js';
import type { JobProcessor } from './job-processor.js';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { Logger } from '../types/log.types.js';

/** Must match the path segment of the callback_url given to `cloud-render:register-render-node`. */
export const PUSH_NOTIFICATION_PATH = '/render-jobs/notify';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Listens locally for the push notification Laravel sends to this node's
 * own callback_url (see RenderNodePushClient.php) whenever a RenderJob is
 * assigned here. Exposed publicly via CloudflareTunnelService, not by
 * opening a port on the router - this node has no idea what network it's
 * running behind.
 *
 * Deliberately thin: verifies the request (path, size, JSON, signature)
 * and hands off to JobProcessor.handleAssignedJob() without awaiting it -
 * Laravel's RenderNodePushClient has a fixed 3s connect / 5s total
 * timeout, so this must respond immediately regardless of how long the
 * actual render takes.
 */
export class PushServer {
  private readonly server: Server;

  constructor(
    private readonly config: RenderNodeConfig,
    private readonly jobProcessor: JobProcessor,
    private readonly logger: Logger,
  ) {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
  }

  start(): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      this.server.once('error', rejectPromise);
      this.server.listen(this.config.pushServer.port, () => {
        this.server.removeListener('error', rejectPromise);
        this.logger.info('Push server listening', { port: this.config.pushServer.port });
        resolvePromise();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolvePromise) => {
      this.server.close(() => resolvePromise());
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== PUSH_NOTIFICATION_PATH) {
      response.writeHead(404).end();
      return;
    }

    let raw: string;
    try {
      raw = await this.readBody(request);
    } catch (error) {
      this.logger.warn('Failed to read push notification body', { error: (error as Error).message });
      response.writeHead(400).end();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      response.writeHead(400).end();
      return;
    }

    const verified = verifyPushNotification(
      parsed as Record<string, unknown>,
      this.config,
    );

    if (!verified) {
      this.logger.warn('Push notification verification failed (invalid signature/timestamp/field)');
      response.writeHead(401).end();
      return;
    }

    response.writeHead(200).end();

    this.jobProcessor
      .handleAssignedJob(verified.jobUuid, verified.claimToken)
      .catch((error: unknown) => {
        this.logger.error('Job processing after push failed', {
          jobUuid: verified.jobUuid,
          error: (error as Error).message,
        });
      });
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      request.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          rejectPromise(new Error('Request body too large.'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });

      request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')));
      request.on('error', rejectPromise);
    });
  }
}
