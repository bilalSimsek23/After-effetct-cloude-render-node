export const RenderJobType = {
  PREVIEW: 'preview',
  FINAL: 'final',
} as const;

export type RenderJobType = (typeof RenderJobType)[keyof typeof RenderJobType];

export const RenderJobPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
} as const;

export type RenderJobPriority = (typeof RenderJobPriority)[keyof typeof RenderJobPriority];

/**
 * A unit of work handed to the Render Node by Laravel. Mirrors the
 * render_projects / render_project_variables data on the Laravel side,
 * flattened into the shape a render engine will eventually consume.
 *
 * `engine` is a free string (not a union) because supported engines are
 * open-ended and configured per node (see RenderNodeConfig.supportedEngines),
 * mirroring the equally free-form `engine` column on the Laravel side.
 */
export interface RenderJob {
  uuid: string;
  engine: string;
  renderProjectUuid: string;
  renderTemplateUuid: string;
  type: RenderJobType;
  priority: RenderJobPriority;
  variables: Record<string, unknown>;
}
