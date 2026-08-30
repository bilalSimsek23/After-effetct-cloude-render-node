import { ContractSchemaName, createContractEnvelope } from './contract-envelope.js';
import type { ContractEnvelope } from './contract-envelope.js';
import { JsonContractSerializer } from './registry/contract-serializer.js';
import { BaseContractValidator } from './registry/contract-validator.js';
import type { AssetContract } from './asset.contract.js';

export const RENDER_RESULT_CONTRACT_VERSION = '1.1.0';

/** ffprobe-derived facts about the rendered output file — mirrors utils/ffprobe-metadata.ts's OutputMetadata exactly (collected in CollectOutputStage, previously discarded before ever reaching Laravel). */
export interface RenderResultOutputMetadata {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  hasAudio: boolean;
}

/** The only model a completed render is ever reported as. Output files reuse Asset Contract — never a bespoke shape. */
export interface RenderResultContract extends ContractEnvelope<
  typeof ContractSchemaName.RENDER_RESULT
> {
  previewUrl: string | null;
  masterUrl: string | null;
  /** The output file's own content duration (ffprobe) — how long the finished video plays for, unrelated to how long rendering took. */
  durationSeconds: number;
  files: AssetContract[];
  logs: string[];
  warnings: string[];
  /**
   * 1.1.0 additions (Render Telemetry & Reliability Foundation) — both
   * optional so a 1.0.0-shaped payload (or a validator built against the
   * older schema) still passes: `executionDurationSeconds` is
   * ExecutionPipeline's own measured wall-clock time for the whole
   * load→cleanup run (ExecutionResult.durationMs / 1000), a second,
   * independently-sourced number Laravel can cross-check against its own
   * render_started_at/render_completed_at timestamps rather than trusting
   * either single source alone. `outputMetadata` is the resolution/fps/
   * codec/audio facts CollectOutputStage already collects via ffprobe.
   */
  executionDurationSeconds?: number;
  outputMetadata?: RenderResultOutputMetadata;
}

export function createRenderResultContract(
  payload: Omit<RenderResultContract, keyof ContractEnvelope>,
  version: string = RENDER_RESULT_CONTRACT_VERSION,
): RenderResultContract {
  return {
    ...createContractEnvelope(ContractSchemaName.RENDER_RESULT, version),
    ...payload,
  };
}

export class RenderResultSerializer extends JsonContractSerializer<RenderResultContract> {}

export class RenderResultValidator extends BaseContractValidator<RenderResultContract> {
  constructor() {
    super('RenderResult', ContractSchemaName.RENDER_RESULT);
  }

  protected validatePayload(record: Record<string, unknown>): string[] {
    const issues: string[] = [];
    if (typeof record.durationSeconds !== 'number' || record.durationSeconds < 0) {
      issues.push('durationSeconds must be a non-negative number');
    }
    if (!Array.isArray(record.files)) issues.push('files must be an array');
    if (!Array.isArray(record.logs)) issues.push('logs must be an array');
    if (!Array.isArray(record.warnings)) issues.push('warnings must be an array');
    return issues;
  }
}
