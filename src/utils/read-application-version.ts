import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedVersion: string | null = null;

/**
 * Reads the "version" field from package.json. Read via fs (not a static
 * import) so the compiled dist/ output has no build-time coupling to a
 * file outside of src/.
 */
export function readApplicationVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  try {
    const raw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = parsed.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }

  return cachedVersion;
}
