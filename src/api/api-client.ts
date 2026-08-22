import { randomUUID } from 'node:crypto';
import type { IApiClient } from './api-client.interface.js';
import { ApiEndpoints } from './api-endpoints.js';
import { sleep } from '../utils/sleep.js';
import { RenderJobType, RenderJobPriority } from '../types/job.types.js';
import type { RenderJob } from '../types/job.types.js';
import { AssetType, createAssetContract } from '../contracts/asset.contract.js';
import type { AssetContract } from '../contracts/asset.contract.js';
import type { NodeInfo } from '../types/node-info.types.js';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { Logger } from '../types/log.types.js';
import type { NodeIdentityService } from '../services/node-identity.service.js';
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

const MOCK_NETWORK_DELAY_MS = 150;
const UNKNOWN_NODE_UUID = 'unknown';

/**
 * Mock implementation of IApiClient. Every method logs the request it will
 * eventually send to Laravel and returns a canned response — no real HTTP
 * call happens yet, since the Cloud Rendering API endpoints don't exist on
 * the Laravel side in this phase. claimJob() always returns a freshly
 * generated dummy job so the full register → heartbeat → poll → complete
 * loop can be exercised end to end without a live server.
 *
 * Owns attaching node_uuid to every request: register() is the one call
 * that produces it (and stores it into NodeIdentityService); every other
 * method reads it back from there, so callers never have to pass it in.
 */
export class ApiClient implements IApiClient {
  /**
   * Faz 3A — TemplateDownloadService now genuinely verifies `asset.hash`
   * against the downloaded file's real SHA-256 (see its own docblock: was
   * always a no-op against this mock before, since the mock has no way to
   * know a real file's hash on its own). A check script that stages a
   * real local fixture file before calling prepare() can register that
   * file's real hash here so this mock's checksum stays genuinely
   * verifiable instead of permanently mismatching. Templates with no
   * registered hash keep the old placeholder (unaffected check scripts
   * that never exercise checksum verification are unchanged).
   */
  private readonly templateAssetHashOverrides = new Map<string, string>();

  constructor(
    private readonly config: RenderNodeConfig,
    private readonly logger: Logger,
    private readonly nodeIdentity: NodeIdentityService,
  ) {}

  setTemplateAssetHash(templateUuid: string, hash: string): void {
    this.templateAssetHashOverrides.set(templateUuid, hash);
  }

  async register(nodeInfo: NodeInfo): Promise<RegisterResponse> {
    this.logMockCall('POST', ApiEndpoints.REGISTER, { nodeName: this.config.nodeName, nodeInfo });
    await sleep(MOCK_NETWORK_DELAY_MS);

    const response: RegisterResponse = { success: true, nodeUuid: randomUUID() };
    this.nodeIdentity.setNodeUuid(response.nodeUuid);

    return response;
  }

  async heartbeat(metrics: HeartbeatMetrics): Promise<HeartbeatResponse> {
    this.logMockCall('POST', ApiEndpoints.HEARTBEAT, {
      nodeUuid: this.currentNodeUuid(),
      ...metrics,
    });
    await sleep(MOCK_NETWORK_DELAY_MS);

    return { success: true };
  }

  async claimJob(): Promise<RenderJob | null> {
    this.logMockCall('POST', ApiEndpoints.CLAIM_JOB, { nodeUuid: this.currentNodeUuid() });
    await sleep(MOCK_NETWORK_DELAY_MS);

    return this.createMockJob();
  }

  async jobProgress(jobUuid: string, payload: JobProgressPayload): Promise<void> {
    this.logMockCall('POST', ApiEndpoints.jobProgress(jobUuid), {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
    await sleep(MOCK_NETWORK_DELAY_MS);
  }

  async jobCompleted(jobUuid: string, payload?: JobCompletedPayload): Promise<void> {
    this.logMockCall('POST', ApiEndpoints.jobComplete(jobUuid), {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
    await sleep(MOCK_NETWORK_DELAY_MS);
  }

  async jobFailed(jobUuid: string, payload: JobFailedPayload): Promise<void> {
    this.logMockCall('POST', ApiEndpoints.jobFailed(jobUuid), {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
    await sleep(MOCK_NETWORK_DELAY_MS);
  }

  async reportSystemStatus(payload: SystemStatusReportPayload): Promise<void> {
    this.logMockCall('POST', ApiEndpoints.SYSTEM_STATUS, {
      nodeUuid: this.currentNodeUuid(),
      ...payload,
    });
    await sleep(MOCK_NETWORK_DELAY_MS);
  }

  async getDependencyPackage(renderTemplateUuid: string): Promise<DependencyPackageInfo | null> {
    this.logMockCall('GET', ApiEndpoints.dependencyPackage(renderTemplateUuid), {
      nodeUuid: this.currentNodeUuid(),
    });
    await sleep(MOCK_NETWORK_DELAY_MS);

    return {
      packageUuid: randomUUID(),
      packageVersion: 1,
      downloadUrl: `${this.config.server}${ApiEndpoints.dependencyPackage(renderTemplateUuid)}/download`,
    };
  }

  async getTemplateAsset(templateUuid: string): Promise<AssetContract> {
    this.logMockCall('GET', ApiEndpoints.templateAsset(templateUuid), {
      nodeUuid: this.currentNodeUuid(),
    });
    await sleep(MOCK_NETWORK_DELAY_MS);

    const assetUuid = randomUUID();

    // Mock: a real backend supplies the file's actual hash/size here.
    // Falls back to a placeholder that deliberately never matches any real
    // file when no override was registered (see templateAssetHashOverrides) —
    // TemplateDownloadService's checksum verification (Faz 3A) then
    // correctly fails for it, same as it would for real corrupted data.
    return createAssetContract({
      uuid: assetUuid,
      hash: this.templateAssetHashOverrides.get(templateUuid) ?? 'mock-hash-unavailable',
      size: 0,
      type: AssetType.PROJECT,
      downloadUrl: `${this.config.server}${ApiEndpoints.templateAsset(templateUuid)}/download`,
      cacheKey: `${templateUuid}:${assetUuid}`,
    });
  }

  private createMockJob(): RenderJob {
    return {
      uuid: randomUUID(),
      engine: this.config.engine,
      renderProjectUuid: randomUUID(),
      renderTemplateUuid: randomUUID(),
      type: RenderJobType.PREVIEW,
      priority: RenderJobPriority.NORMAL,
      variables: {
        title_text: 'Mock Job',
      },
    };
  }

  private currentNodeUuid(): string {
    const nodeUuid = this.nodeIdentity.getNodeUuid();

    if (!nodeUuid) {
      this.logger.warn('node_uuid henüz mevcut değil (register tamamlanmamış olabilir)');
      return UNKNOWN_NODE_UUID;
    }

    return nodeUuid;
  }

  private logMockCall(method: string, path: string, payload?: unknown): void {
    this.logger.debug(
      `[mock] ${method} ${this.config.server}${path}`,
      payload ? { payload } : undefined,
    );
  }
}
