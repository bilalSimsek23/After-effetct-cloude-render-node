import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Logger } from '../../types/log.types.js';

// AdobeWorkspaceService always roots itself under the real OS homedir
// (see its constructor) — not injectable. To test cleanupExpiredWorkspaces()
// against an isolated, disposable directory without touching the real
// ~/Library/Application Support folder, os.homedir() is mocked for the
// duration of this file only, pointed at a fresh mkdtemp() directory.
const fakeHome = await mkdtemp(resolve(tmpdir(), 'motioncurate-workspace-test-'));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

const { AdobeWorkspaceService } = await import('./adobe-workspace.service.js');

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('AdobeWorkspaceService — Community Render Asset Protection phase', () => {
  let service: InstanceType<typeof AdobeWorkspaceService>;

  beforeEach(async () => {
    service = new AdobeWorkspaceService(makeLogger());
    await service.ensure();
  });

  afterEach(async () => {
    await rm(fakeHome, { recursive: true, force: true });
    await mkdir(fakeHome, { recursive: true });
  });

  async function makeJobWorkspace(jobUuid: string, ageMs: number): Promise<void> {
    const paths = await service.createJobWorkspace(jobUuid);
    const old = new Date(Date.now() - ageMs);
    await utimes(paths.root, old, old);
  }

  it('deletes a job workspace older than maxAgeMs', async () => {
    await makeJobWorkspace('stale-job', 48 * 60 * 60 * 1000); // 48h old

    const deleted = await service.cleanupExpiredWorkspaces(24 * 60 * 60 * 1000);

    expect(deleted).toContain('stale-job');
    expect(await service.getJobWorkspace('stale-job')).toBeNull();
  });

  it('does not delete a workspace younger than maxAgeMs', async () => {
    await makeJobWorkspace('fresh-job', 60 * 1000); // 1 minute old

    const deleted = await service.cleanupExpiredWorkspaces(24 * 60 * 60 * 1000);

    expect(deleted).not.toContain('fresh-job');
    expect(await service.getJobWorkspace('fresh-job')).not.toBeNull();
  });

  it('NEVER deletes an active job workspace, even if it looks stale by mtime', async () => {
    await makeJobWorkspace('active-but-old', 48 * 60 * 60 * 1000);

    const deleted = await service.cleanupExpiredWorkspaces(
      24 * 60 * 60 * 1000,
      new Set(['active-but-old']),
    );

    expect(deleted).not.toContain('active-but-old');
    expect(await service.getJobWorkspace('active-but-old')).not.toBeNull();
  });

  it('deleteJobWorkspace() removes exactly the one job requested', async () => {
    await service.createJobWorkspace('to-delete');
    await service.createJobWorkspace('to-keep');

    await service.deleteJobWorkspace('to-delete');

    expect(await service.getJobWorkspace('to-delete')).toBeNull();
    expect(await service.getJobWorkspace('to-keep')).not.toBeNull();
  });

  it('createJobWorkspace() produces a fully isolated jobs/{jobUuid}/ directory', async () => {
    const paths = await service.createJobWorkspace('isolated-job');

    expect(paths.root).toContain('isolated-job');
    const stats = await stat(paths.source);
    expect(stats.isDirectory()).toBe(true);
  });
});
