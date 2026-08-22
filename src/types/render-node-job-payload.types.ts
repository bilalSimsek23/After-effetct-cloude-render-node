/**
 * The exact JSON shape Laravel's RenderJobPayloadBuilder.php returns from
 * both the claim and payload endpoints (`job` key of the response body).
 * Deliberately mirrors that PHP class field-for-field rather than reusing
 * RenderJobContract, which is a narrower internal pipeline type (no
 * template/projectAsset/projectPackage/correlationId) built FROM this
 * payload, not equivalent to it.
 */
export interface RenderNodeJobPayload {
  schema: string;
  version: string;
  jobUuid: string;
  templateUuid: string;
  projectUuid: string;
  userUuid: string | null;
  renderType: string;
  priority: string;
  renderProfile: string;
  variables: Record<string, unknown>;
  template: RenderNodeTemplateManifestSource;
  projectAsset: RenderNodeDownloadableAsset | null;
  projectPackage: RenderNodeDownloadablePackage | null;
  /**
   * One entry per IMAGE/VIDEO/AUDIO template variable the buyer actually
   * uploaded a replacement for, keyed by the variable's own key (matches
   * `variables[key]`, which for these keys holds a Laravel storage path
   * string rather than a scalar - never used directly, only as a label;
   * the real bytes come from downloadUrl). A media variable the buyer
   * left unset simply has no entry here.
   */
  variableAssets: Record<string, RenderNodeDownloadableAsset>;
  correlationId: string | null;
}

/**
 * Mirrors RenderJobSnapshotBuilder.php's 'template' blob — the immutable,
 * already-approved manifest data for this job's template, snapshotted at
 * RenderJob creation time. No manifest.json ever ships inside the
 * downloaded projectAsset (that's just the raw .aep/.mogrt) - this is the
 * only manifest source a real Render Node ever sees.
 */
export interface RenderNodeTemplateManifestSource {
  engine: string | null;
  renderComposition: string | null;
  requiresAlpha: boolean;
  renderDurationSeconds: number | null;
  variables: RenderNodeTemplateVariableSource[];
}

export interface RenderNodeTemplateVariableSource {
  key: string;
  label: string;
  type: string;
  defaultValue: unknown;
  sortOrder: number;
  metadata: Record<string, unknown> | null;
}

export interface RenderNodeDownloadableAsset {
  checksumSha256: string | null;
  originalFilename: string;
  downloadUrl: string;
}

export interface RenderNodeDownloadablePackage {
  packageUuid: string;
  version: number;
  checksumSha256: string;
  downloadUrl: string;
}
