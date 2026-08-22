import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DependencyManifest } from './dependency-manifest.types.js';

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

export interface IDependencyManifestReader {
  read(extractedDir: string): Promise<DependencyManifest>;
}

/**
 * Reads and validates dependencies.json from an already-extracted
 * dependency package. Laravel validates the same structure before
 * approving a package, but Render Node re-validates on its own side too —
 * never trust a downloaded/cached file blindly.
 */
export class DependencyManifestReader implements IDependencyManifestReader {
  async read(extractedDir: string): Promise<DependencyManifest> {
    const manifestPath = resolve(extractedDir, 'dependencies.json');

    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf-8');
    } catch (error) {
      throw new ManifestValidationError(
        `dependencies.json bulunamadı: ${manifestPath} (${(error as Error).message})`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ManifestValidationError(
        `dependencies.json geçerli bir JSON değil: ${(error as Error).message}`,
      );
    }

    this.assertValid(parsed);

    return parsed;
  }

  private assertValid(value: unknown): asserts value is DependencyManifest {
    if (typeof value !== 'object' || value === null) {
      throw new ManifestValidationError('dependencies.json kökü bir JSON nesnesi olmalı.');
    }

    const manifest = value as Record<string, unknown>;

    if (typeof manifest.version !== 'number') {
      throw new ManifestValidationError('dependencies.json "version" alanı sayısal olmalı.');
    }

    for (const section of [
      'fonts',
      'plugins',
      'presets',
      'scripts',
      'luts',
      'expressions',
      'assets',
      'cloudFontLinks',
    ]) {
      if (section in manifest && !Array.isArray(manifest[section])) {
        throw new ManifestValidationError(`dependencies.json "${section}" alanı bir dizi olmalı.`);
      }
    }
  }
}
