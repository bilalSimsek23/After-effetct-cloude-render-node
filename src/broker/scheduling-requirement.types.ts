import type { RenderProfileCode } from '../contracts/render-profile.contract.js';
import type { RenderJobPriority } from '../contracts/render-job.contract.js';

/**
 * What the Broker needs to know to pick a node for one Render Job — the
 * central-side equivalent of CapabilityRequirement (which is node-scoped
 * and stays untouched). templateUuid is what Job Affinity/Cache Match
 * scoring keys off of.
 */
export interface SchedulingRequirement {
  engine: string;
  renderProfile: RenderProfileCode;
  templateUuid: string;
  priority: RenderJobPriority;
  requiredFontPackageVersion?: string | null;
  requiredPlugins?: string[];
}
