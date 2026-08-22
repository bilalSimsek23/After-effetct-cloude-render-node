import type { Logger } from '../../types/log.types.js';
import type { DependencyManifest } from './dependency-manifest.types.js';
import type { PluginReport } from './dependency-package.types.js';

export interface IPluginReporterService {
  reportPlugins(manifest: DependencyManifest): PluginReport;
}

/**
 * Plugins are never auto-installed in this phase — only reported, so an
 * operator (or a future phase) knows what needs manual installation on
 * this node. Pure computation, no I/O, hence synchronous.
 */
export class PluginReporterService implements IPluginReporterService {
  constructor(private readonly logger: Logger) {}

  reportPlugins(manifest: DependencyManifest): PluginReport {
    const plugins = manifest.plugins ?? [];
    const required = plugins.filter((plugin) => plugin.required).map((plugin) => plugin.name);
    const optional = plugins.filter((plugin) => !plugin.required).map((plugin) => plugin.name);

    if (required.length > 0) {
      this.logger.warn('Manuel kurulum gereken zorunlu plugin(ler) var', { required });
    }
    if (optional.length > 0) {
      this.logger.info('Manuel kurulum gereken opsiyonel plugin(ler) var', { optional });
    }

    return { required, optional };
  }
}
