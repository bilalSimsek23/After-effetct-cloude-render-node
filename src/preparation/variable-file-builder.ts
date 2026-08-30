import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RenderJobContract } from '../contracts/render-job.contract.js';
import type { ManifestContract } from '../contracts/manifest.contract.js';
import type { JobWorkspacePaths } from '../adobe/runtime/adobe-workspace.service.js';
import type { Logger } from '../types/log.types.js';

const VARIABLES_FILE_NAME = 'variables.json';
const MEDIA_VARIABLE_TYPES = new Set(['IMAGE', 'VIDEO', 'AUDIO']);

export class VariableFileBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariableFileBuildError';
  }
}

export interface VariableFileBuildResult {
  variablesFilePath: string;
  matchedCount: number;
}

export interface IVariableFileBuilder {
  build(
    renderJob: RenderJobContract,
    manifest: ManifestContract,
    jobWorkspace: JobWorkspacePaths,
    mediaAssetLocalPaths: Record<string, string>,
  ): Promise<VariableFileBuildResult>;
}

/**
 * Matches RenderJobContract.variables against the manifest's declared
 * variables (falling back to each variable's defaultValue when the job
 * didn't supply one) and writes the real variables.json a future Render
 * Engine consumes directly — never a bespoke shape assembled elsewhere.
 */
export class VariableFileBuilder implements IVariableFileBuilder {
  constructor(private readonly logger: Logger) {}

  async build(
    renderJob: RenderJobContract,
    manifest: ManifestContract,
    jobWorkspace: JobWorkspacePaths,
    mediaAssetLocalPaths: Record<string, string>,
  ): Promise<VariableFileBuildResult> {
    const values: Record<string, unknown> = {};
    const missingKeys: string[] = [];

    for (const variable of manifest.variables) {
      const isMediaVariable = MEDIA_VARIABLE_TYPES.has(variable.type.toUpperCase());

      if (variable.key in mediaAssetLocalPaths) {
        values[variable.key] = mediaAssetLocalPaths[variable.key];
      } else if (variable.key in renderJob.variables) {
        values[variable.key] = renderJob.variables[variable.key];
      } else if (variable.defaultValue !== null) {
        values[variable.key] = variable.defaultValue;
      } else if (!isMediaVariable) {
        // IMAGE/VIDEO/AUDIO are always optional (never have a defaultValue,
        // by design) — leaving one unset means "keep the original embedded
        // asset", not a missing required variable.
        missingKeys.push(variable.key);
      }
    }

    if (missingKeys.length > 0) {
      throw new VariableFileBuildError(
        `RenderJob is missing required variable(s): ${missingKeys.join(', ')}`,
      );
    }

    await mkdir(jobWorkspace.variables, { recursive: true });
    const variablesFilePath = resolve(jobWorkspace.variables, VARIABLES_FILE_NAME);
    await writeFile(variablesFilePath, JSON.stringify(values, null, 2), 'utf-8');

    this.logger.info('variables.json created', {
      variablesFilePath,
      matchedCount: manifest.variables.length,
    });

    return { variablesFilePath, matchedCount: manifest.variables.length };
  }
}
