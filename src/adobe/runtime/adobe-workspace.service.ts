import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Logger } from '../../types/log.types.js';

export interface WorkspacePaths {
  root: string;
  workspace: string;
  logs: string;
  scripts: string;
  temp: string;
  cache: string;
  jobs: string;
}

/**
 * A single Render Job's fully isolated working directory. No two jobs
 * ever share a folder — `jobUuid` is the sole namespace, which also makes
 * a job's data self-contained enough to be moved to a different Render
 * Farm node in the future.
 */
export interface JobWorkspacePaths {
  jobUuid: string;
  root: string;
  source: string;
  project: string;
  preview: string;
  master: string;
  logs: string;
  temp: string;
  cache: string;
  /** Added in Phase 4 — where the job's Dependency Package is downloaded/extracted. */
  dependency: string;
  /** Added in Phase 4 — where the Project Preparation Pipeline extracts the .aep/.mogrt chain. */
  extracted: string;
  /** Added in Phase 4 — where manifest.json (from the extracted project) is read from. */
  manifest: string;
  /** Added in Phase 4 — where the generated variables.json for the Render Engine is written. */
  variables: string;
  /** Where buyer-uploaded IMAGE/VIDEO/AUDIO variable replacement assets are downloaded before apply-variables.jsx runs. */
  assets: string;
}

const APP_SUPPORT_FOLDER_NAME = 'MotionCurate Render Node';
const DEFAULT_MAX_JOB_WORKSPACE_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Owns Render Node's own working directory — never the Desktop — under the
 * platform's real per-user app-data location:
 *  - macOS: ~/Library/Application Support/MotionCurate Render Node/
 *  - Windows: %APPDATA%\MotionCurate Render Node\ (i.e.
 *    C:\Users\<user>\AppData\Roaming\...) — confirmed empirically
 *    (2026-08-30) that the macOS path literally does not exist as a real
 *    folder concept on Windows; it previously resolved to the nonsensical
 *    but technically creatable `<home>\Library\Application Support\...`,
 *    which worked by accident (mkdir doesn't care that "Library" isn't a
 *    real Windows convention) rather than by design.
 *
 * Two layers:
 *  - Node-level (workspace/logs/scripts/temp/cache/jobs): one per node,
 *    created once by ensure().
 *  - Job-level (jobs/{job_uuid}/...): one per Render Job, created on
 *    demand by createJobWorkspace(). No files are populated into either
 *    layer yet — this phase only prepares the directory structure.
 */
export class AdobeWorkspaceService {
  private readonly paths: WorkspacePaths;

  constructor(private readonly logger: Logger) {
    const root =
      process.platform === 'win32'
        ? resolve(process.env['APPDATA'] ?? resolve(homedir(), 'AppData', 'Roaming'), APP_SUPPORT_FOLDER_NAME)
        : resolve(homedir(), 'Library', 'Application Support', APP_SUPPORT_FOLDER_NAME);

    this.paths = {
      root,
      workspace: resolve(root, 'workspace'),
      logs: resolve(root, 'logs'),
      scripts: resolve(root, 'scripts'),
      temp: resolve(root, 'temp'),
      cache: resolve(root, 'cache'),
      jobs: resolve(root, 'jobs'),
    };
  }

  getPaths(): WorkspacePaths {
    return { ...this.paths };
  }

  async ensure(): Promise<WorkspacePaths> {
    const directories = [
      this.paths.workspace,
      this.paths.logs,
      this.paths.scripts,
      this.paths.temp,
      this.paths.cache,
      this.paths.jobs,
    ];

    for (const directory of directories) {
      await mkdir(directory, { recursive: true });
    }

    this.logger.info('Workspace created', { root: this.paths.root });

    return this.getPaths();
  }

  getJobWorkspacePaths(jobUuid: string): JobWorkspacePaths {
    const root = resolve(this.paths.jobs, jobUuid);

    return {
      jobUuid,
      root,
      source: resolve(root, 'source'),
      project: resolve(root, 'project'),
      preview: resolve(root, 'preview'),
      master: resolve(root, 'master'),
      logs: resolve(root, 'logs'),
      temp: resolve(root, 'temp'),
      cache: resolve(root, 'cache'),
      dependency: resolve(root, 'dependency'),
      extracted: resolve(root, 'extracted'),
      manifest: resolve(root, 'manifest'),
      variables: resolve(root, 'variables'),
      assets: resolve(root, 'assets'),
    };
  }

  async createJobWorkspace(jobUuid: string): Promise<JobWorkspacePaths> {
    const paths = this.getJobWorkspacePaths(jobUuid);
    const directories = [
      paths.source,
      paths.project,
      paths.preview,
      paths.master,
      paths.logs,
      paths.temp,
      paths.cache,
      paths.dependency,
      paths.extracted,
      paths.manifest,
      paths.variables,
      paths.assets,
    ];

    for (const directory of directories) {
      await mkdir(directory, { recursive: true });
    }

    this.logger.info('Job Workspace created', {
      jobUuid,
      root: paths.root,
      event: 'render_workspace_created',
    });

    return paths;
  }

  async getJobWorkspace(jobUuid: string): Promise<JobWorkspacePaths | null> {
    const paths = this.getJobWorkspacePaths(jobUuid);

    try {
      await stat(paths.root);
      return paths;
    } catch {
      return null;
    }
  }

  /**
   * Community Render Asset Protection & Project Lifecycle Security phase —
   * now actually called, from JobProcessor.processJob()'s own outer
   * finally, once every job (success or failure) is fully resolved. Left
   * to throw on a genuine failure (e.g. a locked/in-use file) — the
   * caller is responsible for catching it, logging
   * render_workspace_cleanup_failed, and never letting that failure alter
   * the job's already-decided/reported result (see JobProcessor's own
   * comment on this call site).
   */
  async deleteJobWorkspace(jobUuid: string): Promise<void> {
    const paths = this.getJobWorkspacePaths(jobUuid);
    await rm(paths.root, { recursive: true, force: true });
    this.logger.info('Job Workspace deleted', {
      jobUuid,
      event: 'render_workspace_cleanup_completed',
    });
  }

  /**
   * Removes job workspaces whose folder hasn't been touched in `maxAgeMs`
   * — the recovery path for a workspace left behind by a node crash/restart
   * (JobProcessor's own end-of-job deleteJobWorkspace() call above handles
   * the normal case; this is only for what that call never got a chance to
   * run for). `excludeJobUuids` is a hard safety guarantee, independent of
   * mtime: a currently-in-flight job's workspace is never a candidate for
   * deletion here even if some pathological clock/mtime state would
   * otherwise make it look stale (see NodeRunner's own wiring, which
   * always passes JobProcessor's live active-job UUID set).
   */
  async cleanupExpiredWorkspaces(
    maxAgeMs: number = DEFAULT_MAX_JOB_WORKSPACE_AGE_MS,
    excludeJobUuids: ReadonlySet<string> = new Set(),
  ): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.paths.jobs, { withFileTypes: true });
    } catch {
      return [];
    }

    const now = Date.now();
    const deletedJobUuids: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (excludeJobUuids.has(entry.name)) {
        continue;
      }

      const jobRoot = resolve(this.paths.jobs, entry.name);

      try {
        const stats = await stat(jobRoot);
        if (now - stats.mtimeMs > maxAgeMs) {
          await rm(jobRoot, { recursive: true, force: true });
          deletedJobUuids.push(entry.name);
        }
      } catch {
        continue;
      }
    }

    if (deletedJobUuids.length > 0) {
      this.logger.info('Expired Job Workspaces cleaned up', {
        jobUuids: deletedJobUuids,
        event: 'render_workspace_cleanup_completed',
      });
    }

    return deletedJobUuids;
  }
}
