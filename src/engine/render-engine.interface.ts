import type { RenderJob } from '../types/job.types.js';

/**
 * Contract every concrete render engine (After Effects, Premiere, DaVinci,
 * ...) will implement. No implementations exist yet — this phase only
 * defines the shape EngineManager routes jobs through, so JobManager never
 * needs to know how a specific engine works.
 */
export interface IRenderEngine {
  readonly name: string;
  execute(job: RenderJob): Promise<void>;
}
