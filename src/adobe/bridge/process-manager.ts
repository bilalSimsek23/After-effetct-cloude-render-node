import { readdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { withTimeout } from '../../utils/with-timeout.js';
import type { Logger } from '../../types/log.types.js';

const execFileAsync = promisify(execFile);
const APPLICATIONS_DIR = '/Applications';
const DEFAULT_COMMAND_TIMEOUT_MS = 10000;

export interface InstalledAppLookup {
  bundlePath: string;
  bundleName: string;
}

/**
 * The narrow slice of ProcessManager that CloudFontActivatorService actually
 * needs, extracted so callers can depend on this instead of the concrete
 * macOS-only class - WindowsProcessManager implements it too, letting both
 * platforms share one CloudFontActivatorService with no code of its own
 * changed (see create-adobe-bridge.ts, the one place that picks which
 * concrete class backs this interface).
 */
export interface IUrlOpener {
  openUrl(url: string): Promise<void>;
}

/**
 * OS-level application mechanics: discovering an installed app under
 * /Applications, reading its bundle version, and launching it. The only
 * class besides AppleScriptRunner that touches the filesystem or spawns
 * processes for Adobe purposes.
 *
 * Adobe installs each app inside its own product folder (e.g.
 * "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app"),
 * alongside extra tooling (Scripts, Presets, a Render Engine helper app),
 * so discovery has to look one level inside the matched folder rather than
 * treating /Applications entries as bundles directly.
 */
export class ProcessManager implements IUrlOpener {
  constructor(private readonly logger: Logger) {}

  async findInstalledApp(folderNamePattern: RegExp): Promise<InstalledAppLookup | null> {
    let entries;
    try {
      entries = await readdir(APPLICATIONS_DIR, { withFileTypes: true });
    } catch (error) {
      this.logger.warn('Failed to read /Applications directory', { error: (error as Error).message });
      return null;
    }

    const candidateFolders = entries
      .filter((entry) => entry.isDirectory() && folderNamePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse(); // newest year first, e.g. "... 2026" before "... 2025"

    for (const folderName of candidateFolders) {
      const bundleName = `${folderName}.app`;
      const bundlePath = resolve(APPLICATIONS_DIR, folderName, bundleName);

      try {
        await access(bundlePath);
        return { bundlePath, bundleName };
      } catch {
        continue;
      }
    }

    return null;
  }

  async readBundleVersion(bundlePath: string): Promise<string | null> {
    const infoPlistBase = resolve(bundlePath, 'Contents', 'Info');

    try {
      const { stdout } = await withTimeout(
        execFileAsync('defaults', ['read', infoPlistBase, 'CFBundleShortVersionString']),
        DEFAULT_COMMAND_TIMEOUT_MS,
        'readBundleVersion',
      );
      const version = stdout.trim();
      return version.length > 0 ? version : null;
    } catch (error) {
      this.logger.warn('Failed to read application version', {
        bundlePath,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async launchApp(bundlePath: string): Promise<void> {
    await withTimeout(
      execFileAsync('open', ['-a', bundlePath]),
      DEFAULT_COMMAND_TIMEOUT_MS,
      'launchApp',
    );
  }

  /**
   * Opens a URL in the default browser (macOS `open <url>`, distinct from
   * `open -a <bundlePath>` above which launches a specific app). Used for
   * Adobe Fonts (cloud font) activation links - see
   * CloudFontActivatorService, the only caller.
   */
  async openUrl(url: string): Promise<void> {
    await withTimeout(execFileAsync('open', [url]), DEFAULT_COMMAND_TIMEOUT_MS, 'openUrl');
  }
}
