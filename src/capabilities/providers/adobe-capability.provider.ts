import type { IAfterEffectsEngine } from '../../adobe/engines/after-effects.engine.js';
import type { IRenderEngine } from '../../adobe/engines/after-effects-render.engine.js';
import type { ICapabilityProvider } from '../capability-provider.interface.js';
import type { CapabilityAdobeInfo } from '../../contracts/capability-report.contract.js';

/**
 * Reads (never modifies) the existing Adobe engines to report AE/ME
 * versions and Dynamic Link availability — the same major-version-family
 * check used by the Adobe Environment check.
 */
export class AdobeCapabilityProvider implements ICapabilityProvider<CapabilityAdobeInfo> {
  readonly name = 'adobe';

  constructor(
    private readonly afterEffectsEngine: IAfterEffectsEngine,
    private readonly renderEngine: IRenderEngine,
  ) {}

  async collect(): Promise<CapabilityAdobeInfo> {
    const afterEffectsVersion = (await this.afterEffectsEngine.isInstalled())
      ? await this.afterEffectsEngine.getVersion()
      : null;
    const mediaEncoderVersion = (await this.renderEngine.isInstalled())
      ? await this.renderEngine.getVersion()
      : null;

    const dynamicLinkAvailable =
      afterEffectsVersion !== null &&
      mediaEncoderVersion !== null &&
      afterEffectsVersion.split('.')[0] === mediaEncoderVersion.split('.')[0];

    return { afterEffectsVersion, mediaEncoderVersion, dynamicLinkAvailable };
  }
}
