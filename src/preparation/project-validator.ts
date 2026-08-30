import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContractName } from '../contracts/registry/contract-name.js';
import type { ContractRegistry } from '../contracts/registry/contract-registry.js';
import { isContractVersionCompatible } from '../contracts/contract-version.js';
import { createManifestContract } from '../contracts/manifest.contract.js';
import type { ManifestContract } from '../contracts/manifest.contract.js';
import { createTemplateVariableContract } from '../contracts/template-variable.contract.js';
import type { JobWorkspacePaths } from '../adobe/runtime/adobe-workspace.service.js';
import type { RenderNodeTemplateManifestSource } from '../types/render-node-job-payload.types.js';
import type { Logger } from '../types/log.types.js';

const MANIFEST_FILE_NAME = 'manifest.json';

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

export interface ProjectValidationResult {
  manifest: ManifestContract;
  manifestFilePath: string;
}

export interface IProjectValidator {
  validate(
    templateSnapshot: RenderNodeTemplateManifestSource,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<ProjectValidationResult>;
}

/**
 * Builds and validates this job's manifest — no manifest.json ever ships
 * inside the downloaded project asset (that's just the raw .aep/.mogrt as
 * the author uploaded it), so the only real manifest source is Laravel's
 * own template snapshot, already delivered in the claim payload. Still
 * routes through the same Contract validation + version-compatibility gate
 * as a Scanner-produced manifest would, and still writes a real
 * manifest.json into the job workspace since the JSX/execution layer reads
 * it straight off disk.
 */
export class ProjectValidator implements IProjectValidator {
  constructor(
    private readonly contractRegistry: ContractRegistry,
    private readonly logger: Logger,
  ) {}

  async validate(
    templateSnapshot: RenderNodeTemplateManifestSource,
    jobWorkspace: JobWorkspacePaths,
  ): Promise<ProjectValidationResult> {
    const candidate = createManifestContract({
      schemaVersion: '1.0.0',
      scannerVersion: 'laravel-render-job-snapshot',
      engine: templateSnapshot.engine ?? '',
      variables: templateSnapshot.variables.map((variable) =>
        createTemplateVariableContract({
          key: variable.key,
          label: variable.label,
          type: variable.type,
          defaultValue: (variable.defaultValue ?? null) as string | null,
          sortOrder: variable.sortOrder,
          metadata: variable.metadata,
        }),
      ),
      metadata: {
        renderComposition: templateSnapshot.renderComposition,
        requiresAlpha: templateSnapshot.requiresAlpha,
        renderDurationSeconds: templateSnapshot.renderDurationSeconds,
      },
    });

    let manifest: ManifestContract;
    try {
      manifest = this.contractRegistry.validate(
        ContractName.MANIFEST,
        candidate,
      ) as ManifestContract;
    } catch (error) {
      throw new ProjectValidationError(
        `Failed to build manifest from template snapshot: ${(error as Error).message}`,
      );
    }

    const expectedVersion = this.contractRegistry.getCurrentVersion(ContractName.MANIFEST);
    if (!isContractVersionCompatible(manifest.version, expectedVersion)) {
      throw new ProjectValidationError(
        `Manifest Contract version mismatch: project came with "${manifest.version}", this node expects "${expectedVersion}".`,
      );
    }

    await mkdir(jobWorkspace.manifest, { recursive: true });
    const manifestFilePath = resolve(jobWorkspace.manifest, MANIFEST_FILE_NAME);
    await writeFile(manifestFilePath, JSON.stringify(manifest, null, 2), 'utf-8');

    this.logger.info('Project manifest validated', {
      manifestFilePath,
      scannerVersion: manifest.scannerVersion,
      variableCount: manifest.variables.length,
    });

    return { manifest, manifestFilePath };
  }
}
