import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withTimeout } from '../../utils/with-timeout.js';
import type { Logger } from '../../types/log.types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15000;

export interface AppleScriptResult {
  stdout: string;
}

/**
 * The only place in the codebase that spawns `osascript`. Runs raw
 * AppleScript source or a script file and returns its output, wrapped in
 * the shared timeout utility. No other class touches child_process for
 * AppleScript purposes.
 */
export class AppleScriptRunner {
  constructor(private readonly logger: Logger) {}

  async run(script: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<AppleScriptResult> {
    try {
      const { stdout } = await withTimeout(
        execFileAsync('osascript', ['-e', script]),
        timeoutMs,
        'osascript',
      );
      return { stdout: stdout.trim() };
    } catch (error) {
      this.logger.debug('AppleScript execution error', { error: (error as Error).message });
      throw error;
    }
  }

  async runFile(
    scriptPath: string,
    args: string[] = [],
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<AppleScriptResult> {
    try {
      const { stdout } = await withTimeout(
        execFileAsync('osascript', [scriptPath, ...args]),
        timeoutMs,
        'osascript-file',
      );
      return { stdout: stdout.trim() };
    } catch (error) {
      this.logger.debug('AppleScript file execution error', {
        scriptPath,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
