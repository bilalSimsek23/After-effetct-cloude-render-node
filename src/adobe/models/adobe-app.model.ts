import { AdobeAppId } from './adobe-app-id.js';

export interface AdobeAppDescriptor {
  id: AdobeAppId;
  /** Human-readable label used in logs and error messages. */
  label: string;
  /**
   * Matches the *product folder* name under /Applications (e.g.
   * "Adobe After Effects 2026"), not the .app bundle itself — Adobe
   * installs each app inside its own folder alongside extra tooling
   * (Scripts, Presets, a Render Engine helper app, ...).
   */
  folderNamePattern: RegExp;
}

export const ADOBE_APP_DESCRIPTORS: Record<AdobeAppId, AdobeAppDescriptor> = {
  [AdobeAppId.AFTER_EFFECTS]: {
    id: AdobeAppId.AFTER_EFFECTS,
    label: 'Adobe After Effects',
    folderNamePattern: /^Adobe After Effects \d{4}$/,
  },
  [AdobeAppId.MEDIA_ENCODER]: {
    id: AdobeAppId.MEDIA_ENCODER,
    label: 'Adobe Media Encoder',
    folderNamePattern: /^Adobe Media Encoder \d{4}$/,
  },
};
