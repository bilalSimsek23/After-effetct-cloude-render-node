import AdmZip from 'adm-zip';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { Logger } from '../types/log.types.js';
import type { JobWorkspacePaths } from '../adobe/runtime/adobe-workspace.service.js';

const NESTED_ARCHIVE_EXTENSIONS = new Set(['.zip', '.mogrt', '.aegraphic']);
const MAX_EXTRACTION_DEPTH = 5;

export class ProjectExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectExtractionError';
  }
}

export interface ProjectExtractionResult {
  projectFilePath: string;
  extractedDir: string;
}

export interface IProjectExtractor {
  extract(
    sourceFilePath: string,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<ProjectExtractionResult>;
}

/**
 * A real, recursive "extract, search for .aep, if absent extract any
 * nested archive and repeat" implementation — no literal .mogrt →
 * .aegraphic → project.zip → .aep chain is hardcoded. A real Envato-style
 * MOGRT sample only nests one level (outer zip → project.zip → .aep), but
 * this handles a deeper chain identically, bounded by
 * MAX_EXTRACTION_DEPTH so a malformed package can't loop forever.
 */
export class ProjectExtractor implements IProjectExtractor {
  constructor(private readonly logger: Logger) {}

  async extract(
    sourceFilePath: string,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<ProjectExtractionResult> {
    const rootDir = jobWorkspace.extracted;
    await mkdir(rootDir, { recursive: true });

    let currentArchivePath = sourceFilePath;

    for (let depth = 0; depth < MAX_EXTRACTION_DEPTH; depth += 1) {
      const currentDir = resolve(rootDir, `depth-${depth}`);
      new AdmZip(currentArchivePath).extractAllTo(currentDir, true);

      this.logger.info('Project archive extracted', {
        depth,
        archivePath: currentArchivePath,
        destinationDir: currentDir,
      });

      const aepPath = await this.findFileByExtension(currentDir, '.aep');
      if (aepPath) {
        return { projectFilePath: aepPath, extractedDir: currentDir };
      }

      const nestedArchivePath = await this.findFileByExtensions(
        currentDir,
        NESTED_ARCHIVE_EXTENSIONS,
      );
      if (!nestedArchivePath) {
        throw new ProjectExtractionError(
          `Found neither a .aep file nor a nested archive inside "${currentArchivePath}".`,
        );
      }

      currentArchivePath = nestedArchivePath;
    }

    throw new ProjectExtractionError(
      `Reached maximum extraction depth (${MAX_EXTRACTION_DEPTH}), no .aep file found.`,
    );
  }

  private async findFileByExtension(dir: string, extension: string): Promise<string | null> {
    return this.findFileByExtensions(dir, new Set([extension]));
  }

  private async findFileByExtensions(dir: string, extensions: Set<string>): Promise<string | null> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        const found = await this.findFileByExtensions(entryPath, extensions);
        if (found) {
          return found;
        }
        continue;
      }

      if (extensions.has(extname(entry.name).toLowerCase())) {
        return entryPath;
      }
    }

    return null;
  }
}
