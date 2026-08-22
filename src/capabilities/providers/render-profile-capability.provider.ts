import type { RenderProfileRegistry } from '../../adobe/models/render-profile.registry.js';
import { RenderProfileCode } from '../../contracts/render-profile.contract.js';
import type { ICapabilityProvider } from '../capability-provider.interface.js';

/**
 * Reads (never modifies) the existing Adobe-phase RenderProfileRegistry
 * and reports only the profiles it actually has configured and active —
 * currently preview/master. Vertical/Square/ProRes/Alpha are valid
 * Contract values for the future, but this provider never claims support
 * for a profile the node doesn't really have configured.
 */
export class RenderProfileCapabilityProvider implements ICapabilityProvider<RenderProfileCode[]> {
  readonly name = 'render-profile';

  constructor(private readonly renderProfileRegistry: RenderProfileRegistry) {}

  async collect(): Promise<RenderProfileCode[]> {
    return this.renderProfileRegistry
      .list()
      .filter((profile) => profile.isActive)
      .map((profile) => this.toContractCode(profile.code))
      .filter((code): code is RenderProfileCode => code !== null);
  }

  private toContractCode(code: string): RenderProfileCode | null {
    return Object.values(RenderProfileCode).includes(code as RenderProfileCode)
      ? (code as RenderProfileCode)
      : null;
  }
}
