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
 * Owns Render Node's own working directory under
 * ~/Library/Application Support/MotionCurate Render Node/ — never the
 * Desktop.
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
    const root = resolve(homedir(), 'Library', 'Application Support', APP_SUPPORT_FOLDER_NAME);

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

    this.logger.info('Workspace oluşturuldu', { root: this.paths.root });

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

    this.logger.info('Job Workspace oluşturuldu', { jobUuid, root: paths.root });

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

  async deleteJobWorkspace(jobUuid: string): Promise<void> {
    const paths = this.getJobWorkspacePaths(jobUuid);
    await rm(paths.root, { recursive: true, force: true });
    this.logger.info('Job Workspace silindi', { jobUuid });
  }

  /**
   * Removes job workspaces whose folder hasn't been touched in
   * `maxAgeMs`. Nothing calls this yet — it exists so a future scheduled
   * cleanup task (or the Render phases, once jobs actually finish) has
   * somewhere to call into.
   */
  async cleanupExpiredWorkspaces(
    maxAgeMs: number = DEFAULT_MAX_JOB_WORKSPACE_AGE_MS,
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
      this.logger.info("Süresi dolmuş Job Workspace'ler temizlendi", {
        jobUuids: deletedJobUuids,
      });
    }

    return deletedJobUuids;
  }
}
