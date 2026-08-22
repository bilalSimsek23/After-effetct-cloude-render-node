/**
 * Every .jsx file this Render Node can run, by name — never a hardcoded
 * string literal at a call site. Adding a new script means adding one
 * constant here and one file next to it.
 */
export const JsxScriptName = {
  OPEN_PROJECT: 'open-project.jsx',
  APPLY_VARIABLES: 'apply-variables.jsx',
  SAVE_PROJECT: 'save-project.jsx',
  QUEUE_MEDIA_ENCODER: 'queue-media-encoder.jsx',
  CHECK_RENDER_STATUS: 'check-render-status.jsx',
  DETECT_CAPABILITIES: 'detect-capabilities.jsx',
  CLOSE_PROJECT: 'close-project.jsx',
} as const;

export type JsxScriptName = (typeof JsxScriptName)[keyof typeof JsxScriptName];
