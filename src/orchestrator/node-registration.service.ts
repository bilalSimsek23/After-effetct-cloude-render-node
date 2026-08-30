import type { AdobeRuntimeService } from '../adobe/runtime/adobe-runtime.service.js';
import { SystemReadyStatus } from '../adobe/models/environment-check.types.js';
import type { CapabilityRegistry } from '../capabilities/capability-registry.js';
import type { CapabilityReportContract } from '../contracts/capability-report.contract.js';
import type { RenderNodeConfig } from '../types/config.types.js';
import type { Logger } from '../types/log.types.js';

export class NodeRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeRegistrationError';
  }
}

/**
 * The Node Lifecycle's first two local steps: Environment Check (via
 * AdobeRuntimeService.initialize()) → Capability Registry collect(). There
 * is no Laravel self-registration call here (or anywhere) - this node's
 * identity (nodeUuid/apiSecret) was already provisioned out of band by an
 * admin running `php artisan cloud-render:register-render-node` and is
 * loaded straight from config (see AuthService's docblock); "registration"
 * from this node's own perspective is purely local readiness verification.
 */
export class NodeRegistrationService {
  constructor(
    private readonly adobeRuntimeService: AdobeRuntimeService,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly config: RenderNodeConfig,
    private readonly logger: Logger,
  ) {}

  async register(): Promise<CapabilityReportContract> {
    const environmentResult = await this.adobeRuntimeService.initialize();

    if (environmentResult.status !== SystemReadyStatus.READY) {
      throw new NodeRegistrationError(
        `Adobe Runtime not ready, node cannot start: ${environmentResult.errors.join(', ')}`,
      );
    }

    const report = await this.capabilityRegistry.register();

    this.logger.info('Node ready (identity pre-provisioned via config)', {
      nodeUuid: this.config.nodeUuid,
    });

    return report;
  }
}
