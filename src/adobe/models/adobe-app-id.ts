export const AdobeAppId = {
  AFTER_EFFECTS: 'after-effects',
  MEDIA_ENCODER: 'media-encoder',
} as const;

export type AdobeAppId = (typeof AdobeAppId)[keyof typeof AdobeAppId];
