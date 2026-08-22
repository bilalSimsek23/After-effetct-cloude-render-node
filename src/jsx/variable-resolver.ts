import { readFile, writeFile } from 'node:fs/promises';
import {
  VariableType,
  UnsupportedVariableTypeError,
  PropertyAddressResolutionError,
} from './variable-application.types.js';
import type { ResolvedVariableEntry } from './variable-application.types.js';
import type { ManifestContract } from '../contracts/manifest.contract.js';
import type { Logger } from '../types/log.types.js';

export interface IVariableResolver {
  resolve(
    variablesFilePath: string,
    manifestFilePath: string,
    resolvedOutputPath: string,
  ): Promise<ResolvedVariableEntry[]>;
}

/**
 * Combines variables.json (real values, produced by Phase 4's
 * VariableFileBuilder — untouched) with manifest.json (real types, same
 * Manifest Contract Phase 4 already validated — untouched) into one
 * resolved, type-normalized list, written to its own real file. apply-
 * variables.jsx reads that file — it never touches variables.json or
 * manifest.json directly, and Node never decides which AE property a
 * variable maps to (that's PropertyResolver's job, JSX-side).
 *
 * Unsupported types are rejected HERE, before any Adobe round-trip —
 * "Sessiz geçilmemeli" enforced at the earliest possible point.
 */
export class VariableResolver implements IVariableResolver {
  constructor(private readonly logger: Logger) {}

  async resolve(
    variablesFilePath: string,
    manifestFilePath: string,
    resolvedOutputPath: string,
  ): Promise<ResolvedVariableEntry[]> {
    const values = JSON.parse(await readFile(variablesFilePath, 'utf-8')) as Record<
      string,
      unknown
    >;
    const manifest = JSON.parse(await readFile(manifestFilePath, 'utf-8')) as ManifestContract;

    const entries: ResolvedVariableEntry[] = manifest.variables.map((variable) => {
      const type = this.normalizeType(variable.type, variable.key);
      const { compositionName, layerName, propertyPath, propertyMatchName } = this.resolveAddress(
        variable.key,
        type,
        variable.metadata,
      );
      return {
        key: variable.key,
        type,
        value: values[variable.key],
        compositionName,
        layerName,
        propertyPath,
        propertyMatchName,
      };
    });

    await writeFile(resolvedOutputPath, JSON.stringify(entries, null, 2), 'utf-8');

    this.logger.debug('Değişkenler çözümlendi', {
      count: entries.length,
      resolvedOutputPath,
    });

    return entries;
  }

  private normalizeType(rawType: string, key: string): VariableType {
    const upper = rawType.toUpperCase();
    if (!Object.values(VariableType).includes(upper as VariableType)) {
      throw new UnsupportedVariableTypeError(rawType, key);
    }
    return upper as VariableType;
  }

  /**
   * Extracts the real AE property address from the manifest variable's
   * free-form `metadata` — see ResolvedVariableEntry's doc comment for
   * why this is necessary rather than resolving Essential Graphics
   * controllers at apply-time. Rejected here, before any Adobe round-trip,
   * same as an unsupported type would be.
   *
   * `compositionName` is required (Faz 8C) — the production Scanner spec
   * (generate_manifest.jsx) always resolves it, and requiring it here
   * closes a real ambiguity: two different compositions can have layers
   * with the same name, and only compositionName+layerName together
   * address one real layer. `propertyMatchName` is optional and, when
   * present, lets PropertyResolver (JSX-side) run the same matchName+
   * displayName fallback apply_manifest.jsx runs in production if the
   * propertyPath walk itself doesn't resolve.
   */
  private resolveAddress(
    key: string,
    type: VariableType,
    metadata: Record<string, unknown> | null,
  ): {
    compositionName: string;
    layerName: string;
    propertyPath: string[];
    propertyMatchName: string | null;
  } {
    const compositionName =
      metadata && typeof metadata.compositionName === 'string' ? metadata.compositionName : null;
    if (!compositionName) {
      throw new PropertyAddressResolutionError(
        key,
        'metadata.compositionName eksik veya string değil',
      );
    }

    const layerName =
      metadata && typeof metadata.layerName === 'string' ? metadata.layerName : null;
    if (!layerName) {
      throw new PropertyAddressResolutionError(key, 'metadata.layerName eksik veya string değil');
    }

    const isMediaType =
      type === VariableType.IMAGE || type === VariableType.VIDEO || type === VariableType.AUDIO;
    const rawPath = metadata && Array.isArray(metadata.propertyPath) ? metadata.propertyPath : [];
    const propertyPath = rawPath.filter(
      (segment): segment is string => typeof segment === 'string',
    );

    if (!isMediaType && propertyPath.length === 0) {
      throw new PropertyAddressResolutionError(
        key,
        'metadata.propertyPath eksik veya boş (medya olmayan tipler için zorunlu)',
      );
    }

    const propertyMatchName =
      metadata && typeof metadata.propertyMatchName === 'string'
        ? metadata.propertyMatchName
        : null;

    return { compositionName, layerName, propertyPath, propertyMatchName };
  }
}
