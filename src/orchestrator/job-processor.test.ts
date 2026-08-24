import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobProcessor } from './job-processor.js';
import { ExecutionResultStatus } from '../execution/execution-result.js';
import { PreparedProjectStatus } from '../preparation/prepared-project.types.js';
import { RenderJobPriority, RenderJobRenderType } from '../contracts/render-job.contract.js';
import type { Logger } from '../types/log.types.js';

// processJob() calls mkdir() (via downloadAsset's destination directory)
// on the real filesystem - stubbed so this test never touches real disk.
// Must be a top-level call (vitest hoists vi.mock() above all imports
// regardless of where it's textually placed, but keeping it here avoids
// the hoisting warning and reflects actual execution order honestly).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: vi.fn().mockResolvedValue(undefined) };
});

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * Community Render Asset Protection & Project Lifecycle Security phase —
 * JobProcessor.processJob()'s outer finally must ALWAYS call
 * workspaceService.deleteJobWorkspace(), regardless of whether the job
 * succeeded, failed inside the pipeline, or threw before the pipeline
 * even started — and a cleanup failure there must never change what
 * result was already reported to Laravel.
 */
describe('JobProcessor — guaranteed workspace cleanup', () => {
  const jobUuid = 'job-uuid-1';
  let deps: {
    laravelApiClient: { claimRenderJob: ReturnType<typeof vi.fn>; downloadAsset: ReturnType<typeof vi.fn>; declineRenderJob: ReturnType<typeof vi.fn> };
    adobeRuntimeService: { createSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn> };
    workspaceService: { getPaths: ReturnType<typeof vi.fn>; deleteJobWorkspace: ReturnType<typeof vi.fn> };
    capabilityRegistry: { getCapabilities: ReturnType<typeof vi.fn> };
    renderProfileRegistry: { find: ReturnType<typeof vi.fn> };
    projectPreparationService: { prepare: ReturnType<typeof vi.fn> };
    executionContextBuilder: { build: ReturnType<typeof vi.fn> };
    executionPipeline: { run: ReturnType<typeof vi.fn> };
    progressForwarder: object;
    retryPolicy: object;
    resultForwarder: { send: ReturnType<typeof vi.fn>; sendFailed: ReturnType<typeof vi.fn> };
    config: { maxConcurrentJobs: number; engine: string };
    logger: Logger;
  };

  beforeEach(() => {
    deps = {
      laravelApiClient: {
        claimRenderJob: vi.fn().mockResolvedValue({
          jobUuid,
          templateUuid: 'template-1',
          projectUuid: 'project-1',
          userUuid: 'user-1',
          variables: {},
          priority: RenderJobPriority.NORMAL,
          renderType: RenderJobRenderType.PREVIEW,
          template: {},
          projectAsset: { downloadUrl: 'https://example.test/asset', checksumSha256: 'abc', originalFilename: 'p.zip' },
          projectPackage: null,
          variableAssets: {},
        }),
        downloadAsset: vi.fn().mockResolvedValue(undefined),
        declineRenderJob: vi.fn().mockResolvedValue(undefined),
      },
      adobeRuntimeService: {
        createSession: vi.fn().mockResolvedValue({ getWorkspace: () => ({}) }),
        closeSession: vi.fn().mockResolvedValue(undefined),
      },
      workspaceService: {
        getPaths: vi.fn().mockReturnValue({ temp: '/tmp/motioncurate-test' }),
        deleteJobWorkspace: vi.fn().mockResolvedValue(undefined),
      },
      capabilityRegistry: { getCapabilities: vi.fn().mockReturnValue({}) },
      renderProfileRegistry: { find: vi.fn().mockReturnValue({}) },
      projectPreparationService: {
        prepare: vi.fn().mockResolvedValue({
          jobUuid,
          status: PreparedProjectStatus.READY,
          projectFilePath: '/tmp/project.aep',
          variablesFilePath: '/tmp/variables.json',
          workspace: {},
          errors: [],
        }),
      },
      executionContextBuilder: { build: vi.fn().mockReturnValue({ job: { jobUuid } }) },
      executionPipeline: {
        run: vi.fn().mockResolvedValue({
          status: ExecutionResultStatus.COMPLETED,
          jobUuid,
          durationMs: 100,
          renderResult: {},
          errors: [],
        }),
      },
      progressForwarder: {},
      retryPolicy: {},
      resultForwarder: {
        send: vi.fn().mockResolvedValue(undefined),
        sendFailed: vi.fn().mockResolvedValue(undefined),
      },
      config: { maxConcurrentJobs: 1, engine: 'AFTER_EFFECTS' },
      logger: makeLogger(),
    };
  });

  function buildProcessor(): JobProcessor {
    return new JobProcessor(
      deps.laravelApiClient as never,
      deps.adobeRuntimeService as never,
      deps.workspaceService as never,
      deps.capabilityRegistry as never,
      deps.renderProfileRegistry as never,
      deps.projectPreparationService as never,
      deps.executionContextBuilder as never,
      deps.executionPipeline as never,
      deps.progressForwarder as never,
      deps.retryPolicy as never,
      deps.resultForwarder as never,
      deps.config as never,
      deps.logger,
    );
  }

  it('deletes the job workspace after a fully successful job', async () => {
    const processor = buildProcessor();

    await processor.handleAssignedJob(jobUuid, 'claim-token');

    expect(deps.workspaceService.deleteJobWorkspace).toHaveBeenCalledWith(jobUuid);
    expect(deps.resultForwarder.send).toHaveBeenCalled();
  });

  it('still deletes the job workspace when the pipeline reports FAILED', async () => {
    deps.executionPipeline.run.mockResolvedValue({
      status: ExecutionResultStatus.FAILED,
      jobUuid,
      durationMs: 100,
      renderResult: null,
      errors: ['render failed'],
    });
    const processor = buildProcessor();

    await processor.handleAssignedJob(jobUuid, 'claim-token');

    expect(deps.workspaceService.deleteJobWorkspace).toHaveBeenCalledWith(jobUuid);
  });

  it('still deletes the job workspace when preparation fails before the pipeline ever runs', async () => {
    deps.projectPreparationService.prepare.mockResolvedValue({
      jobUuid,
      status: PreparedProjectStatus.FAILED,
      projectFilePath: null,
      variablesFilePath: null,
      workspace: {},
      errors: ['dependency missing'],
    });
    const processor = buildProcessor();

    await processor.handleAssignedJob(jobUuid, 'claim-token');

    expect(deps.workspaceService.deleteJobWorkspace).toHaveBeenCalledWith(jobUuid);
    expect(deps.executionPipeline.run).not.toHaveBeenCalled();
  });

  it('still deletes the job workspace when an unexpected exception is thrown', async () => {
    deps.executionPipeline.run.mockRejectedValue(new Error('unexpected crash'));
    const processor = buildProcessor();

    await processor.handleAssignedJob(jobUuid, 'claim-token');

    expect(deps.workspaceService.deleteJobWorkspace).toHaveBeenCalledWith(jobUuid);
    expect(deps.resultForwarder.sendFailed).toHaveBeenCalled();
  });

  it('a workspace cleanup failure is logged but does not change the already-sent job result', async () => {
    deps.workspaceService.deleteJobWorkspace.mockRejectedValue(new Error('EBUSY: file locked'));
    const processor = buildProcessor();

    await processor.handleAssignedJob(jobUuid, 'claim-token');

    // The successful result was still sent — cleanup failing afterwards
    // must not retroactively change or block that.
    expect(deps.resultForwarder.send).toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('temizliği başarısız'),
      expect.objectContaining({ event: 'render_workspace_cleanup_failed', jobUuid }),
    );
  });

  it('releases activeJobUuids/activeJobCount even when cleanup fails, so the node accepts new jobs', async () => {
    deps.workspaceService.deleteJobWorkspace.mockRejectedValue(new Error('EBUSY'));
    const processor = buildProcessor();

    await processor.handleAssignedJob(jobUuid, 'claim-token');

    expect(processor.getRunningJobCount()).toBe(0);
    expect(processor.getActiveJobUuids().has(jobUuid)).toBe(false);
  });

  it('tracks the job as active while it is running', async () => {
    let capturedDuringRun = false;
    deps.executionPipeline.run.mockImplementation(async () => {
      capturedDuringRun = processorRef.getActiveJobUuids().has(jobUuid);
      return {
        status: ExecutionResultStatus.COMPLETED,
        jobUuid,
        durationMs: 10,
        renderResult: {},
        errors: [],
      };
    });
    const processorRef = buildProcessor();

    await processorRef.handleAssignedJob(jobUuid, 'claim-token');

    expect(capturedDuringRun).toBe(true);
    expect(processorRef.getActiveJobUuids().has(jobUuid)).toBe(false);
  });
});
