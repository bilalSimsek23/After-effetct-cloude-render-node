import type { AdobeAppInfo } from './adobe-app-info.types.js';
import { SystemReadyStatus } from '../../types/system-status.types.js';

export { SystemReadyStatus };

export interface EnvironmentCheckResult {
  status: SystemReadyStatus;
  errors: string[];
  afterEffects: AdobeAppInfo;
  mediaEncoder: AdobeAppInfo;
  sameMajorVersionFamily: boolean;
  dynamicLinkAvailable: boolean;
  workspaceReady: boolean;
}
