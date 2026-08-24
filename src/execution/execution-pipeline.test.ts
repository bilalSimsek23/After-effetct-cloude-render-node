import { describe, it, expect, vi } from 'vitest';
import { ExecutionPipeline } from './execution-pipeline.js';
import { ExecutionStageError } from './execution-stage.interface.js';
import { ExecutionResultStatus } from './execution-result.js';
import { ErrorCode } from '../errors/error-code.js';
import type { ExecutionContext, ExecutionState } from './execution-context.js';
import type { IExecutionStage } from './execution-stage.interface.js';
import type { Logger } from '../types/log.types.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeContractRegistry(): ContractRegistry {
  return {
    getCurrentVersion: vi.fn().mockReturnValue('1.0.0'),
    validate: vi.fn(),
  } as unknown as ContractRegistry;
}

function makeContext(overrides?: Partial<{ closeProject: () => Promise<void> }>): {
  context: ExecutionContext;
  closeProject: ReturnType<typeof vi.fn>;
} {
  const closeProject = overrides?.closeProject
    ? vi.fn(overrides.closeProject)
    : vi.fn().mockResolvedValue(undefined);

  const state: ExecutionState = {
    renderQueueItemId: null,
    outputFilePath: null,
    uploadedUrl: null,
    renderQueueItemIndex: null,
    outputMetadata: null,
  };

  const context = {
    job: { jobUuid: 'job-1', renderType: 'PREVIEW' },
    preparedProject: {},
    workspace: {},
    renderProfile: {},
    adobeSession: { dispose: vi.fn().mockResolvedValue(undefined) },
    afterEffectsEngine: { closeProject },
    renderEngine: {},
    progressService: { stage: vi.fn().mockResolvedValue(undefined) },
    retryPolicy: { execute: vi.fn() },
    logger: makeLogger(),
    state,
  } as unknown as ExecutionContext;

  return { context, closeProject };
}

function makeStage(name: string, behavior?: (ctx: ExecutionContext) => Promise<ExecutionContext>): IExecutionStage {
  return {
    name,
    execute: behavior ?? (async (ctx) => ctx),
  };
}

function buildPipeline(stages: {
  load?: IExecutionStage;
  applyVariables?: IExecutionStage;
  save?: IExecutionStage;
  queueRender?: IExecutionStage;
  waitRender?: IExecutionStage;
  collectOutput?: IExecutionStage;
  uploadOutput?: IExecutionStage;
  cleanup?: IExecutionStage;
  logger?: Logger;
}): ExecutionPipeline {
  return new ExecutionPipeline(
    (stages.load ?? makeStage('LoadProjectStage')) as never,
    (stages.applyVariables ?? makeStage('ApplyVariablesStage')) as never,
    (stages.save ?? makeStage('SaveProjectStage')) as never,
    (stages.queueRender ?? makeStage('QueueRenderStage')) as never,
    (stages.waitRender ?? makeStage('WaitRenderStage')) as never,
    (stages.collectOutput ?? makeStage('CollectOutputStage')) as never,
    (stages.uploadOutput ?? makeStage('UploadOutputStage')) as never,
    (stages.cleanup ?? makeStage('CleanupStage')) as never,
    makeContractRegistry(),
    stages.logger ?? makeLogger(),
  );
}

describe('ExecutionPipeline — guaranteed AE project close (Community Render Asset Protection phase)', () => {
  it('closes the project on a fully successful run', async () => {
    const { context, closeProject } = makeContext();
    const pipeline = buildPipeline({});

    const result = await pipeline.run(context);

    expect(result.status).toBe(ExecutionResultStatus.COMPLETED);
    expect(closeProject).toHaveBeenCalledTimes(1);
  });

  it('closes the project when a stage throws (e.g. save/render failure)', async () => {
    const { context, closeProject } = makeContext();
    const failingSave = makeStage('SaveProjectStage', async () => {
      throw new ExecutionStageError('SaveProjectStage', ErrorCode.PROJECT_NOT_READY, 'kaydetme başarısız');
    });
    const pipeline = buildPipeline({ save: failingSave });

    const result = await pipeline.run(context);

    expect(result.status).toBe(ExecutionResultStatus.FAILED);
    expect(closeProject).toHaveBeenCalledTimes(1);
  });

  it('closes the project on a render timeout (WaitRenderStage throwing)', async () => {
    const { context, closeProject } = makeContext();
    const timingOutWait = makeStage('WaitRenderStage', async () => {
      throw new Error('Render zaman aşımına uğradı');
    });
    const pipeline = buildPipeline({ waitRender: timingOutWait });

    const result = await pipeline.run(context);

    expect(result.status).toBe(ExecutionResultStatus.FAILED);
    expect(closeProject).toHaveBeenCalledTimes(1);
  });

  it('closes the project even when LoadProjectStage itself throws before opening anything', async () => {
    const { context, closeProject } = makeContext();
    const failingLoad = makeStage('LoadProjectStage', async () => {
      throw new ExecutionStageError('LoadProjectStage', ErrorCode.PROJECT_NOT_READY, 'proje bulunamadı');
    });
    const pipeline = buildPipeline({ load: failingLoad });

    const result = await pipeline.run(context);

    expect(result.status).toBe(ExecutionResultStatus.FAILED);
    // closeProject()'s own JSX no-ops safely if nothing was ever opened —
    // it is still called unconditionally from the pipeline's side.
    expect(closeProject).toHaveBeenCalledTimes(1);
  });

  it('a close failure is swallowed — the render result reflects the actual stage outcome, not the close failure', async () => {
    const { context, closeProject } = makeContext({
      closeProject: async () => {
        throw new Error('AE JSX köprüsü yanıt vermiyor');
      },
    });
    const pipelineLogger = makeLogger();
    const pipeline = buildPipeline({ logger: pipelineLogger });

    const result = await pipeline.run(context);

    // The stages all succeeded — a close failure must not flip this to FAILED.
    expect(result.status).toBe(ExecutionResultStatus.COMPLETED);
    expect(closeProject).toHaveBeenCalledTimes(1);
    expect(pipelineLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('kapatılamadı'),
      expect.objectContaining({ event: 'render_project_close_failed' }),
    );
  });

  it('a close failure does not turn an already-failed stage outcome into something else either', async () => {
    const { context, closeProject } = makeContext({
      closeProject: async () => {
        throw new Error('AE JSX köprüsü yanıt vermiyor');
      },
    });
    const failingSave = makeStage('SaveProjectStage', async () => {
      throw new Error('kaydetme başarısız');
    });
    const pipeline = buildPipeline({ save: failingSave });

    const result = await pipeline.run(context);

    expect(result.status).toBe(ExecutionResultStatus.FAILED);
    expect(result.errors[0]).toContain('kaydetme başarısız');
    expect(closeProject).toHaveBeenCalledTimes(1);
  });

  it('serializes two concurrent run() calls through the AE-touching window (same pipeline instance)', async () => {
    const events: string[] = [];

    const { context: contextA } = makeContext();
    const { context: contextB } = makeContext();
    contextB.job.jobUuid = 'job-2';

    const slowLoad = makeStage('LoadProjectStage', async (ctx) => {
      events.push(`${ctx.job.jobUuid}:load-start`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push(`${ctx.job.jobUuid}:load-end`);
      return ctx;
    });
    const pipeline = buildPipeline({ load: slowLoad });

    await Promise.all([pipeline.run(contextA), pipeline.run(contextB)]);

    // job-1's entire AE-touching window (including its close) must finish
    // before job-2's even starts - never interleaved.
    expect(events).toEqual([
      'job-1:load-start',
      'job-1:load-end',
      'job-2:load-start',
      'job-2:load-end',
    ]);
  });
});
