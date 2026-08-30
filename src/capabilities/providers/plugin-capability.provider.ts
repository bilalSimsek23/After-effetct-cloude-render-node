import type { Logger } from '../../types/log.types.js';
import type { ICapabilityProvider } from '../capability-provider.interface.js';
import type { CapabilityInstalledPluginEntry } from '../../contracts/capability-report.contract.js';

/**
 * No real Adobe plugin scanning exists yet — there's no reliable,
 * documented way to enumerate installed AE/ME plugins from Node without
 * a native probe, and building one is out of scope for this phase. This
 * honestly reports an empty list rather than fabricating plugin data,
 * matching the project's established "boş iskelet servis" convention for
 * capabilities that genuinely aren't buildable yet.
 */
export class PluginCapabilityProvider implements ICapabilityProvider<
  CapabilityInstalledPluginEntry[]
> {
  readonly name = 'plugin';

  constructor(private readonly logger: Logger) {}

  async collect(): Promise<CapabilityInstalledPluginEntry[]> {
    this.logger.debug(
      'PluginCapabilityProvider: no real plugin scanning yet, returning empty list',
    );
    return [];
  }
}
