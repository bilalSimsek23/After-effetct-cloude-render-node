import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { JobRuntimeStats } from '../heartbeat/job-runtime-stats.interface.js';
import type { Logger } from '../types/log.types.js';

const exec = promisify(execCallback);

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

export interface SelfUpdateConfig {
  enabled: boolean;
  checkIntervalMinutes: number;
  branch: string;
}

/**
 * Fleet-wide auto-update: periodically checks the (public) GitHub repo for
 * new commits on `branch` and, if this node is idle, pulls + rebuilds +
 * exits so launchd's KeepAlive relaunches it on the new code. No in-process
 * hot-swap, no manual respawn logic — launchd already does exactly this
 * (see com.pratiktools.render-node.plist's KeepAlive/ThrottleInterval),
 * so self-update only has to get the working tree right and then get out
 * of the way.
 *
 * Safety rules, in order:
 *  - Never touch a node with a job in progress (checked immediately before
 *    every attempt, not just at tick start, so a job that starts mid-check
 *    still can't be interrupted — see checkAndApply()).
 *  - `git pull --ff-only`: refuses instead of merging/overwriting if the
 *    working tree has local changes or has diverged. A node an admin is
 *    hand-debugging on is never silently clobbered.
 *  - If `npm install`/`npm run build` fails after a successful pull, the
 *    working tree is reset back to the last known-good commit and the node
 *    keeps running its current (already-loaded, unaffected) compiled code -
 *    a broken push to `branch` can never take a node down, let alone the
 *    fleet, since every node independently protects itself the same way.
 *  - A commit that's already known to fail the build isn't retried every
 *    tick (which would just fail identically each time) - only a *newer*
 *    commit resets that guard.
 */
export class SelfUpdateLoop {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private lastFailedSha: string | null = null;

  constructor(
    private readonly jobRuntimeStats: JobRuntimeStats,
    private readonly config: SelfUpdateConfig,
    private readonly logger: Logger,
    private readonly workingDirectory: string = process.cwd(),
  ) {}

  start(): void {
    if (!this.config.enabled) {
      this.logger.info('Self-update devre dışı (config.json\'da autoUpdate.enabled=false veya tanımsız)');
      return;
    }
    this.logger.info('Self-update etkin', {
      branch: this.config.branch,
      checkIntervalMinutes: this.config.checkIntervalMinutes,
    });
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private scheduleNext(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(
      () => void this.tick(),
      this.config.checkIntervalMinutes * 60 * 1000,
    );
  }

  private async tick(): Promise<void> {
    try {
      await this.checkAndApply();
    } catch (error) {
      this.logger.error('Self-update kontrolü sırasında beklenmeyen hata', {
        error: (error as Error).message,
      });
    } finally {
      if (!this.stopped) {
        this.scheduleNext();
      }
    }
  }

  private async checkAndApply(): Promise<void> {
    const branch = this.config.branch;

    await this.run(`git fetch origin ${branch} --quiet`);

    const localSha = (await this.run('git rev-parse HEAD')).trim();
    const remoteSha = (await this.run(`git rev-parse origin/${branch}`)).trim();

    if (localSha === remoteSha) {
      this.logger.debug('Self-update: node güncel', { sha: localSha });
      return;
    }

    if (remoteSha === this.lastFailedSha) {
      this.logger.debug('Self-update: bu commit daha önce build\'i geçemedi, yeni bir commit gelene kadar tekrar denenmeyecek', {
        sha: remoteSha,
      });
      return;
    }

    // Re-check immediately before touching anything - a job could have
    // started between the tick firing and reaching this point.
    if (this.jobRuntimeStats.getRunningJobCount() > 0) {
      this.logger.debug('Self-update: aktif job var, bu tur atlanıyor');
      return;
    }

    this.logger.info('Self-update: yeni commit bulundu, güncelleme uygulanıyor', {
      from: localSha,
      to: remoteSha,
    });

    try {
      await this.run(`git pull --ff-only origin ${branch}`);
      await this.run('npm install');
      await this.run('npm run build');
    } catch (error) {
      this.lastFailedSha = remoteSha;
      this.logger.error(
        'Self-update BAŞARISIZ - node önceki çalışan koda geri alınıyor, bu commit tekrar denenmeyecek',
        { error: (error as Error).message, attemptedSha: remoteSha },
      );
      try {
        await this.run(`git reset --hard ${localSha}`);
      } catch (resetError) {
        this.logger.error(
          'Self-update geri alma (rollback) da başarısız oldu - bu node elle kontrol edilmeli',
          { error: (resetError as Error).message },
        );
      }
      return;
    }

    this.logger.info(
      'Self-update başarılı, node yeniden başlatılıyor (launchd KeepAlive otomatik ayağa kaldıracak)',
      { newSha: remoteSha },
    );

    process.exit(0);
  }

  private async run(command: string): Promise<string> {
    const { stdout } = await exec(command, {
      cwd: this.workingDirectory,
      timeout: COMMAND_TIMEOUT_MS,
    });
    return stdout;
  }
}
