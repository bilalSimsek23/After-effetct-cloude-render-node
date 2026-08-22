import { readdir, copyFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface CopyDirectoryContentsResult {
  copied: string[];
  skipped: string[];
}

/**
 * Copies every file directly inside sourceDir into targetDir. Idempotent:
 * a file that already exists at the destination (same name) is left
 * alone, never overwritten. Returns an empty result (no error) if
 * sourceDir doesn't exist — every dependency-package folder is optional.
 */
export async function copyDirectoryContents(
  sourceDir: string,
  targetDir: string,
): Promise<CopyDirectoryContentsResult> {
  const result: CopyDirectoryContentsResult = { copied: [], skipped: [] };

  let entries: string[];
  try {
    entries = await readdir(sourceDir);
  } catch {
    return result;
  }

  await mkdir(targetDir, { recursive: true });

  for (const fileName of entries) {
    const destinationPath = resolve(targetDir, fileName);

    try {
      await access(destinationPath);
      result.skipped.push(fileName);
      continue;
    } catch {
      // Doesn't exist yet at the destination — fall through to copy it.
    }

    await copyFile(resolve(sourceDir, fileName), destinationPath);
    result.copied.push(fileName);
  }

  return result;
}
