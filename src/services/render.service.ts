import type { Logger } from '../types/log.types.js';
import type { RenderJob } from '../types/job.types.js';

export interface IRenderService {
  render(job: RenderJob): Promise<void>;
}

/**
 * Will eventually drive EngineManager to actually render a job. Intentionally
 * does nothing yet — JobManager still uses a fixed dummy delay in this
 * phase, not this service.
 */
export class RenderService implements IRenderService {
  constructor(private readonly logger: Logger) {}

  async render(job: RenderJob): Promise<void> {
    this.logger.debug('RenderService.render() not implemented yet', { jobUuid: job.uuid });
  }
}
