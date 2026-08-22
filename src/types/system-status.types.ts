/**
 * Shared between the Adobe environment check and the API layer: whether
 * this node is fit to accept work. Lives in core types/ (not
 * adobe/models/) since it's reported to Laravel independently of Adobe
 * specifics.
 */
export const SystemReadyStatus = {
  READY: 'READY',
  NOT_READY: 'NOT_READY',
} as const;

export type SystemReadyStatus = (typeof SystemReadyStatus)[keyof typeof SystemReadyStatus];
