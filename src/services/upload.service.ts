import { readFile } from 'node:fs/promises';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { IAuthService } from '../api/auth.service.js';
import { LaravelApiEndpoints } from '../api/laravel-api-endpoints.js';
import type { Logger } from '../types/log.types.js';
import { ErrorCode } from '../errors/error-code.js';
import { RenderNodeError } from '../errors/render-node-error.js';

export interface IUploadService {
  upload(localFilePath: string, jobUuid: string): Promise<string>;
}

export class UploadError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.UPLOAD_FAILED, message, context);
  }
}

/**
 * Uploads a job's finished output straight through Laravel (the same
 * node-auth'd API everything else in this pipeline uses) rather than to a
 * separate R2/S3 endpoint - RenderNodeAssetController stores the bytes and
 * hands back the buyer-facing URL Laravel itself will serve, so
 * `RenderJobProgressService::recordCompleted()` can write it straight onto
 * RenderProject.preview_url/final_url unchanged. The request body is the
 * raw file bytes (matches every other node-auth'd request being signed
 * over its literal wire body) - never multipart, since PHP empties
 * php://input once a multipart body is parsed, which would leave nothing
 * for RenderNodeAuthenticator to verify the signature against.
 */
export class UploadService implements IUploadService {
  constructor(
    private readonly config: RenderNodeConfig,
    private readonly authService: IAuthService,
    private readonly logger: Logger,
  ) {}

  async upload(localFilePath: string, jobUuid: string): Promise<string> {
    const fileBuffer = await readFile(localFilePath);
    const url = `${this.config.server}${LaravelApiEndpoints.jobOutput(jobUuid)}`;

    const response = await fetch(url, {
      method: 'PUT',
      body: fileBuffer,
      headers: {
        ...this.authService.getAuthHeaders(fileBuffer),
        'Content-Type': 'application/octet-stream',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new UploadError(`Yükleme başarısız: ${url} → HTTP ${response.status} ${errorBody}`, {
        url,
        status: response.status,
        localFilePath,
        jobUuid,
      });
    }

    const body = (await response.json().catch(() => null)) as { url?: string } | null;

    if (!body?.url) {
      throw new UploadError(`Yükleme yanıtında 'url' alanı yok: ${url}`, {
        url,
        localFilePath,
        jobUuid,
      });
    }

    this.logger.info('Çıktı yüklendi', { localFilePath, jobUuid, uploadedUrl: body.url });

    return body.url;
  }
}
