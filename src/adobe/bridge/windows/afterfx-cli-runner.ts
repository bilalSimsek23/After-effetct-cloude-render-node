import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { withTimeout } from '../../../utils/with-timeout.js';
import type { Logger } from '../../../types/log.types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15000;

export interface AfterFxCliResult {
  stdout: string;
}

/**
 * Windows counterpart to AppleScriptRunner - the only place in the Windows
 * bridge that spawns AfterFX.exe. Runs a script via the `-r <path.jsx>`
 * flag, confirmed empirically (2026-08-30, real Windows 11 + AE 2024
 * machine) to run against an already-open AE instance without quitting it,
 * or to cold-launch AE (quitting itself afterward) if none was already
 * running - see WindowsProcessManager's docblock for the full finding.
 *
 * AE's own `-r` has no documented way to hand back a return value (no
 * exit-code convention, nothing on stdout reflecting the script's result) -
 * exactly the same "DoScript's return value can't be trusted" situation
 * AdobeBridge already works around on macOS via a file the JSX itself
 * writes. WindowsAdobeBridge reuses that identical file-based convention,
 * so `stdout` here is captured only for logging/diagnostics, never as the
 * actual result channel.
 */
export class AfterFxCliRunner {
  constructor(private readonly logger: Logger) {}

  async runCode(
    afterFxExePath: string,
    jsxCode: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<AfterFxCliResult> {
    const tempScriptPath = join(tmpdir(), `render-node-afterfx-${randomUUID()}.jsx`);
    await writeFile(tempScriptPath, jsxCode, 'utf-8');

    try {
      return await this.runFile(afterFxExePath, tempScriptPath, timeoutMs);
    } finally {
      await rm(tempScriptPath, { force: true }).catch(() => {});
    }
  }

  async runFile(
    afterFxExePath: string,
    scriptPath: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<AfterFxCliResult> {
    try {
      const { stdout } = await withTimeout(
        // `timeout`/`killSignal` matter as much as the outer withTimeout race
        // here: without them, a slow/hung `-r` process (e.g. AE still on its
        // splash screen during a cold launch) keeps running in the
        // background even after Node gives up waiting on it, and can then
        // collide with the *next* `-r` call this class issues against the
        // same singleton AE instance (empirically observed 2026-08-30 — the
        // orphaned process's own script only got a chance to run well after
        // the timed-out call had already returned and a second, overlapping
        // call had already failed against the still-launching instance).
        execFileAsync(afterFxExePath, ['-r', scriptPath], {
          timeout: timeoutMs,
          killSignal: 'SIGTERM',
        }),
        timeoutMs,
        'afterfx-r',
      );
      return { stdout: stdout.trim() };
    } catch (error) {
      this.logger.debug('AfterFX -r execution error', {
        scriptPath,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
