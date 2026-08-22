import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { Logger } from '../types/log.types.js';

const READY_LOG_PATTERN = /Registered tunnel connection/i;
const READY_TIMEOUT_MS = 20_000;

export class CloudflareTunnelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareTunnelError';
  }
}

/**
 * What NodeRunner actually depends on - lets check scripts/tests substitute
 * a no-op implementation instead of spawning a real `cloudflared` process
 * (e.g. when testing PushServer directly on localhost, with no real public
 * hostname involved).
 */
export interface ITunnelService {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Manages the `cloudflared` subprocess that exposes PushServer's local port
 * at a stable public hostname, so Laravel can reach this node's
 * callback_url regardless of what network it's actually running behind
 * (home/office, NAT, no port-forwarding, no static IP - the deployment
 * reality for "installable on any Mac/Windows machine").
 *
 * Assumes a *named*, remotely-managed Cloudflare Tunnel (created once via
 * the Cloudflare Zero Trust dashboard, with its Public Hostname ingress
 * rule already pointed at http://localhost:<pushServer.port>) - the token
 * alone is enough to run it; no local `cloudflared tunnel create`/config
 * YAML is required on this machine. `cloudflared` itself must already be
 * installed and on PATH (see setup docs) - this class does not install it.
 */
export class CloudflareTunnelService implements ITunnelService {
  private process: ChildProcess | null = null;

  constructor(
    private readonly config: RenderNodeConfig,
    private readonly logger: Logger,
  ) {}

  start(): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        'cloudflared',
        ['tunnel', 'run', '--token', this.config.pushServer.tunnelToken],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.process = child;

      let settled = false;
      const readyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.logger.warn(
            'cloudflared "bağlandı" mesajı zaman aşımına uğradı, yine de devam ediliyor',
          );
          resolvePromise();
        }
      }, READY_TIMEOUT_MS);

      child.once('error', (error) => {
        clearTimeout(readyTimer);
        if (!settled) {
          settled = true;
          rejectPromise(
            new CloudflareTunnelError(
              `cloudflared başlatılamadı - PATH üzerinde kurulu mu kontrol edin (${error.message})`,
            ),
          );
        }
      });

      child.once('exit', (code, signal) => {
        this.process = null;
        if (!settled) {
          clearTimeout(readyTimer);
          settled = true;
          rejectPromise(
            new CloudflareTunnelError(
              `cloudflared beklenmedik şekilde kapandı (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
            ),
          );
          return;
        }
        this.logger.warn('cloudflared tüneli kapandı', { code, signal });
      });

      const onOutput = (data: Buffer): void => {
        const text = data.toString('utf-8').trim();
        if (text) {
          this.logger.debug(`[cloudflared] ${text}`);
        }
        if (!settled && READY_LOG_PATTERN.test(text)) {
          clearTimeout(readyTimer);
          settled = true;
          this.logger.info('Cloudflare Tunnel bağlandı');
          resolvePromise();
        }
      };

      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);
    });
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child) {
      return;
    }

    await new Promise<void>((resolvePromise) => {
      child.once('exit', () => resolvePromise());
      child.kill('SIGTERM');
    });
    this.process = null;
  }
}
