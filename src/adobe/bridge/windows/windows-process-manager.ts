import { readdir, access } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { withTimeout } from '../../../utils/with-timeout.js';
import type { Logger } from '../../../types/log.types.js';
import type { InstalledAppLookup, IUrlOpener } from '../process-manager.js';

const execFileAsync = promisify(execFile);
const DEFAULT_COMMAND_TIMEOUT_MS = 10000;

/**
 * Windows counterpart to ProcessManager (macOS). Confirmed empirically
 * against a real Windows 11 + After Effects 2024 machine (2026-08-30, live
 * SSH session) before writing this - not guessed from documentation alone:
 *
 *   - `AfterFX.exe -r <script.jsx>`, run from a NEW (no AE running yet)
 *     state, launches AE, runs the script, writes whatever the script
 *     itself writes to disk, then After Effects quits itself automatically
 *     when the script finishes.
 *   - The SAME command, run while an AfterFX.exe process is ALREADY
 *     running, reuses that instance and does NOT quit it afterward - this
 *     is what lets WindowsAdobeBridge keep one AE instance open across many
 *     fast sequential JSX calls within a single render job, the same shape
 *     as macOS's persistent-process + AppleScript DoScript design, without
 *     needing BridgeTalk (Adobe's inter-app messaging protocol has no
 *     published wire format for a non-Adobe process to speak directly -
 *     confirmed via web research, not just assumed).
 *
 * Adobe installs each AE version inside its own product folder under
 * `%ProgramFiles%\Adobe\` (e.g. "Adobe After Effects 2024"), with the real
 * executable one level inside at `Support Files\AfterFX.exe` - mirrors
 * macOS's /Applications/"Adobe After Effects 2024"/"....app" one-level-deep
 * shape closely enough that the same folderNamePattern regex
 * (ADOBE_APP_DESCRIPTORS) works unchanged on both platforms.
 */
export class WindowsProcessManager implements IUrlOpener {
  constructor(private readonly logger: Logger) {}

  private get programFilesDir(): string {
    return process.env['ProgramFiles'] ?? 'C:\\Program Files';
  }

  async findInstalledApp(folderNamePattern: RegExp): Promise<InstalledAppLookup | null> {
    const adobeDir = join(this.programFilesDir, 'Adobe');

    let entries;
    try {
      entries = await readdir(adobeDir, { withFileTypes: true });
    } catch (error) {
      this.logger.warn('Adobe kurulum dizini okunamadı', {
        adobeDir,
        error: (error as Error).message,
      });
      return null;
    }

    const candidateFolders = entries
      .filter((entry) => entry.isDirectory() && folderNamePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse(); // newest year first, e.g. "... 2024" before "... 2023"

    for (const folderName of candidateFolders) {
      const exePath = resolve(adobeDir, folderName, 'Support Files', 'AfterFX.exe');

      try {
        await access(exePath);
        return { bundlePath: exePath, bundleName: folderName };
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Windows has no CFBundleShortVersionString equivalent reachable without a
   * native addon; the .exe's own PE version resource is the real source of
   * truth, read via a one-line PowerShell call rather than adding a new
   * dependency for something this small and this rarely called (result is
   * cached by the bridge, same as macOS).
   */
  async readBundleVersion(bundlePath: string): Promise<string | null> {
    try {
      const { stdout } = await withTimeout(
        execFileAsync('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Item -LiteralPath '${bundlePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
        ]),
        DEFAULT_COMMAND_TIMEOUT_MS,
        'readBundleVersion',
      );
      const version = stdout.trim();
      return version.length > 0 ? version : null;
    } catch (error) {
      this.logger.warn('Uygulama versiyonu okunamadı', {
        bundlePath,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Fire-and-forget, matching macOS launchApp()'s `open -a` semantics
   * (returns as soon as the process is *started*, never waits for AE to
   * quit) - `detached: true` + `unref()` is the Node equivalent, since a
   * plain execFile()/spawn() without those would keep this process's event
   * loop alive until AfterFX.exe itself exits.
   */
  async launchApp(bundlePath: string): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(bundlePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.once('error', reject);
      // 'spawn' fires once the OS has actually created the process - the
      // earliest point macOS's `open -a` itself guarantees either.
      child.once('spawn', () => {
        child.unref();
        resolvePromise();
      });
    });
  }

  async openUrl(url: string): Promise<void> {
    // The empty '' first argument to `start` is required - without it,
    // `cmd /c start <url>` misreads a URL containing certain characters as
    // the window-title argument instead of the target to open.
    await withTimeout(
      execFileAsync('cmd', ['/c', 'start', '', url]),
      DEFAULT_COMMAND_TIMEOUT_MS,
      'openUrl',
    );
  }
}
