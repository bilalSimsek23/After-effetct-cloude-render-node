import type { IRenderEngine } from './render-engine.interface.js';
import type { RenderJob } from '../types/job.types.js';
import type { Logger } from '../types/log.types.js';

/**
 * Routes a job to the render engine registered for its `engine` field.
 * JobManager talks only to this layer — never directly to Adobe or any
 * other render tooling (JobManager → EngineManager → Engine).
 *
 * No engines are registered in this phase; JobManager does not call
 * execute() yet, since there is nothing registered to route to.
 */
export class EngineManager {
  private readonly engines = new Map<string, IRenderEngine>();

  constructor(private readonly logger: Logger) {}

  registerEngine(engine: IRenderEngine): void {
    this.engines.set(engine.name, engine);
    this.logger.info(`Render motoru kaydedildi: ${engine.name}`);
  }

  listEngineNames(): string[] {
    return Array.from(this.engines.keys());
  }

  hasEngine(name: string): boolean {
    return this.engines.has(name);
  }

  async execute(job: RenderJob): Promise<void> {
    const engine = this.engines.get(job.engine);

    if (!engine) {
      throw new Error(`"${job.engine}" için kayıtlı bir render motoru yok.`);
    }

    this.logger.info(`İş "${engine.name}" motoruna yönlendiriliyor`, { jobUuid: job.uuid });
    await engine.execute(job);
  }
}
