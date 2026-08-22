import type { Logger } from '../types/log.types.js';

export interface IScannerService {
  scan(renderTemplateUuid: string): Promise<void>;
}

/**
 * Will eventually run an engine's scanner (e.g. an After Effects JSX
 * script) against a render template and report the discovered variables
 * to Laravel's /render-templates/{uuid}/scan-result. Intentionally does
 * nothing yet — not wired into main.ts in this phase.
 */
export class ScannerService implements IScannerService {
  constructor(private readonly logger: Logger) {}

  async scan(renderTemplateUuid: string): Promise<void> {
    this.logger.debug('ScannerService.scan() henüz implemente edilmedi', { renderTemplateUuid });
  }
}
