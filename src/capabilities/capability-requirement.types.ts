import type { RenderProfileCode } from '../contracts/render-profile.contract.js';

/** What a Render Job needs from a node, used by supports()/findBestNode(). */
export interface CapabilityRequirement {
  engine: string;
  renderProfile: RenderProfileCode;
  requiredFontPackageVersion?: string | null;
  requiredPlugins?: string[];
}

export interface CapabilityComparisonResult {
  changed: boolean;
  changedFields: string[];
}
