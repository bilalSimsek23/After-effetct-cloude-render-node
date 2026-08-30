import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IApiClient } from './api-client.interface.js';
import { ApiEndpoints } from './api-endpoints.js';
import { LaravelApiEndpoints } from './laravel-api-endpoints.js';
import { ApiError } from './api-error.js';
import type { IAuthService } from './auth.service.js';
import type { NodeIdentityService } from '../services/node-identity.service.js';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { RenderJob } from '../types/job.types.js';
import type { NodeInfo } from '../types/node-info.types.js';
import type {
  RegisterResponse,
  HeartbeatResponse,
  HeartbeatMetrics,
  JobProgressPayload,
  JobCompletedPayload,
  JobFailedPayload,
  SystemStatusReportPayload,
  DependencyPackageInfo,
} from '../types/api.types.js';
import type { AssetContract } from '../contracts/asset.contract.js';
import type { JobHeartbeatContract } from '../contracts/job-heartbeat.contract.js';
import type { RenderProgressContract } from '../contracts/render-progress.contract.js';
import type { RenderResultContract } from '../contracts/render-result.contract.js';
import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { RenderNodeJobPayload } from '../types/render-node-job-payload.types.js';
import type { IRetryPolicyService } from '../services/retry-policy.service.js';
import { RetryOperation } from '../services/retry-policy.service.js';
import type { Logger } from '../types/log.types.js';

const UNKNOWN_NODE_UUID = 'unknown';

/**
 * Everything the new Production Orchestrator layer needs, on top of the
 * original IApiClient (kept for AdobeRuntimeService/the older
 * ProgressService/every existing check script, all untouched). There is no
 * registerNode()/self-registration - a node's identity is provisioned out
 * of band (see AuthService's docblock), so this client never mutates it.
 */
export interface ILaravelApiClient extends IApiClient {
  sendJobHeartbeat(heartbeat: JobHeartbeatContract): Promise<void>;
  /** Render Telemetry & Reliability Foundation — sent on first boot and whenever CapabilityRegistry.compare() detects a real change, never every heartbeat tick. */
  sendCapabilityReport(report: CapabilityReportContract): Promise<void>;
  /** Claims a *specific* job Laravel already pushed a notification for. */
  claimRenderJob(jobUuid: string, claimToken: string): Promise<RenderNodeJobPayload>;
  /**
   * Tells Laravel this node received the push but can't claim it right now
   * (e.g. already at its own concurrency limit) — unlike silently ignoring
   * the push, this lets Laravel requeue/reassign immediately instead of
   * waiting for claim_expires_at to lapse.
   */
  declineRenderJob(jobUuid: string, reason: string): Promise<void>;
  sendJobProgress(jobUuid: string, progress: RenderProgressContract): Promise<void>;
  sendJobCompleted(jobUuid: string, result: RenderResultContract): Promise<void>;
  sendJobFailed(jobUuid: string, errors: string[]): Promise<void>;
  downloadAsset(downloadUrl: string, destinationFilePath: string): Promise<void>;
}

/**
 * The first REAL (non-mock) implementation of Render Node's Laravel
 * client — every method is a genuine HTTP call (Node 22's built-in
 * `fetch`), authenticated via AuthService, retried via the existing
 * RetryPolicyService (RetryOperation.LARAVEL_API — no new retry logic
 * written here). Implements the original IApiClient unchanged (so it's a
 * drop-in replacement for the Phase 1 mock ApiClient wherever an
 * IApiClient is expected, e.g. AdobeRuntimeService) plus the new
 * Contract-based methods the orchestrator layer uses directly.
 */
export class LaravelApiClient implements ILaravelApiClient {
  constructor(
    private readonly config: RenderNodeConfig,
    private readonly authService: IAuthService,
    private readonly nodeIdentity: NodeIdentityService,
    private readonly retryPolicy: IRetryPolicyService,
    private readonly logger: Logger,
  ) {}

  // ---- Original IApiClient (unchanged signatures) ----

  async register(nodeInfo: NodeInfo): Promise<RegisterResponse> {
    const result = await this.request<RegisterResponse>('POST', ApiEndpoints.REGISTER, {
      nodeName: this.config.nodeName,
      nodeInfo,
    });
    this.nodeIdentity.setNodeUuid(result.nodeUuid);
    return result;
  }

  async heartbeat(metrics: HeartbeatMetrics): Promise<HeartbeatResponse> {
    return this.request('POST', ApiEndpoints.HEARTBEAT, {
      nodeUuid: this.currentNodeUuid(),
      ...metrics,
    });
  }

  async claimJob(): Promise<RenderJob | null> {
    return this.request('POST', ApiEndpoints.CLAIM_JOB, { nodeUuid: this.currentNodeUuid() });
  }

  async jobProgress(jobUuid: string, payload: JobProgressPayload): Promise<void> {
    await this.request('POST', ApiEndpoints.jobProgress(jobUuid), {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
  }

  async jobCompleted(jobUuid: string, payload?: JobCompletedPayload): Promise<void> {
    await this.request('POST', ApiEndpoints.jobComplete(jobUuid), {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
  }

  async jobFailed(jobUuid: string, payload: JobFailedPayload): Promise<void> {
    await this.request('POST', ApiEndpoints.jobFailed(jobUuid), {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
  }

  async reportSystemStatus(payload: SystemStatusReportPayload): Promise<void> {
    await this.request('POST', ApiEndpoints.SYSTEM_STATUS, {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
  }

  async getDependencyPackage(renderTemplateUuid: string): Promise<DependencyPackageInfo | null> {
    return this.request('GET', ApiEndpoints.dependencyPackage(renderTemplateUuid));
  }

  async getTemplateAsset(templateUuid: string): Promise<AssetContract> {
    return this.request('GET', ApiEndpoints.templateAsset(templateUuid));
  }

  // ---- New methods (orchestrator layer, real Phase-2 Laravel contract) ----

  async sendJobHeartbeat(heartbeat: JobHeartbeatContract): Promise<void> {
    await this.request('POST', LaravelApiEndpoints.NODE_HEARTBEAT, heartbeat);
  }

  async sendCapabilityReport(report: CapabilityReportContract): Promise<void> {
    await this.request('POST', LaravelApiEndpoints.NODE_CAPABILITY_REPORT, report);
  }

  async claimRenderJob(jobUuid: string, claimToken: string): Promise<RenderNodeJobPayload> {
    const response = await this.request<{ job: RenderNodeJobPayload }>(
      'POST',
      LaravelApiEndpoints.claimJob(jobUuid),
      { claimToken },
    );

    return response.job;
  }

  async declineRenderJob(jobUuid: string, reason: string): Promise<void> {
    await this.request('POST', LaravelApiEndpoints.declineJob(jobUuid), { reason });
  }

  async sendJobProgress(jobUuid: string, progress: RenderProgressContract): Promise<void> {
    await this.request('POST', LaravelApiEndpoints.jobProgress(jobUuid), progress);
  }

  async sendJobCompleted(jobUuid: string, result: RenderResultContract): Promise<void> {
    await this.request('POST', LaravelApiEndpoints.jobCompleted(jobUuid), result);
  }

  async sendJobFailed(jobUuid: string, errors: string[]): Promise<void> {
    await this.request('POST', LaravelApiEndpoints.jobFailed(jobUuid), { errors });
  }

  async downloadAsset(downloadUrl: string, destinationFilePath: string): Promise<void> {
    await this.retryPolicy.execute(RetryOperation.LARAVEL_API, async () => {
      const response = await fetch(downloadUrl, {
        headers: this.authService.getAuthHeaders(''),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ApiError(response.status, downloadUrl, text);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(dirname(destinationFilePath), { recursive: true });
      await writeFile(destinationFilePath, bytes);

      this.logger.debug('Asset downloaded', {
        downloadUrl,
        destinationFilePath,
        bytes: bytes.length,
      });
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.retryPolicy.execute(RetryOperation.LARAVEL_API, async () => {
      // Laravel's RenderNodeAuthenticator recomputes the signature over the
      // exact bytes it reads via $request->getContent() - the signed
      // rawBody here must be the identical string sent as init.body below,
      // not a value re-serialized independently of it.
      const rawBody = body !== undefined ? JSON.stringify(body) : '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.authService.getAuthHeaders(rawBody),
      };

      this.logger.debug(`${method} ${this.config.server}${path}`, body ? { body } : undefined);

      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        init.body = rawBody;
      }

      const response = await fetch(`${this.config.server}${path}`, init);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ApiError(response.status, path, text);
      }

      if (response.status === 204) {
        return null as T;
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : null) as T;
    });
  }

  private currentNodeUuid(): string {
    const nodeUuid = this.nodeIdentity.getNodeUuid();

    if (!nodeUuid) {
      this.logger.warn('node_uuid is not yet available (registration may not have completed)');
      return UNKNOWN_NODE_UUID;
    }

    return nodeUuid;
  }
}
