/**
 * Faz 8B — one stable code per real failure category the Render Node can
 * throw. String-matching an error message is fragile (a message can be
 * reworded without anyone noticing it broke a Laravel-side classification
 * rule); a code is a contract in itself. Register a new code here before
 * using it anywhere — this file is the single source of truth, so two
 * unrelated errors never accidentally share one.
 */
export const ErrorCode = {
  // WORKSPACE_* — Faz 3A: creating a job's isolated workspace directory.
  EXECUTION_WORKSPACE_FAILED: 'WORKSPACE_001',

  // PROJECT_* — opening/loading/preparing the Adobe project itself.
  PROJECT_NOT_READY: 'PROJECT_001',
  PROJECT_FILE_PATH_MISSING: 'PROJECT_002',
  PROJECT_OPEN_FAILED: 'PROJECT_003',
  /** Faz 3A — staging the downloaded template asset into the job workspace failed (includes a checksum mismatch against the Contract's `hash`, when one was supplied). */
  PROJECT_DOWNLOAD_FAILED: 'PROJECT_004',

  // VARIABLE_* — the Variable Engine (resolution + application).
  VARIABLE_UNSUPPORTED_TYPE: 'VARIABLE_001',
  VARIABLE_ADDRESS_RESOLUTION_FAILED: 'VARIABLE_002',
  VARIABLE_APPLICATION_FAILED: 'VARIABLE_003',
  VARIABLE_FILE_PATH_MISSING: 'VARIABLE_004',
  /** Faz 8C — a buyer-uploaded IMAGE/VIDEO/AUDIO variable replacement asset failed to download from Laravel. */
  VARIABLE_ASSET_DOWNLOAD_FAILED: 'VARIABLE_005',

  // DEPENDENCY_* — Faz 3A: the Dependency Package (fonts/presets/media/...).
  DEPENDENCY_DOWNLOAD_FAILED: 'DEPENDENCY_001',
  DEPENDENCY_VALIDATION_FAILED: 'DEPENDENCY_002',

  // RENDER_* — queueing, waiting for, and validating the render itself.
  RENDER_QUEUE_FAILED: 'RENDER_001',
  RENDER_TIMEOUT: 'RENDER_002',
  RENDER_FAILED: 'RENDER_003',
  RENDER_OUTPUT_VALIDATION_FAILED: 'RENDER_004',
  RENDER_OUTPUT_PATH_MISSING: 'RENDER_005',
  RENDER_QUEUE_ITEM_INDEX_MISSING: 'RENDER_006',
  /** Faz 3A — render settings (renderComposition/requiresAlpha/renderDurationSeconds/renderProfile) failed validation, e.g. a named composition that doesn't exist in the project. Never falls back to a different composition silently. */
  RENDER_CONFIGURATION_INVALID: 'RENDER_007',

  // OUTPUT_* — Faz 3A: local output collection, after a successful render.
  OUTPUT_NOT_FOUND: 'OUTPUT_001',
  /** ffprobe metadata collection failed — logged, does not fail an otherwise-successful render (the output file itself is already verified by this point). */
  OUTPUT_METADATA_FAILED: 'OUTPUT_002',

  // UPLOAD_* — delivering the finished output.
  UPLOAD_FAILED: 'UPLOAD_001',

  // JSX_* — AdobeBridge.runJsxCode()'a verilen ExtendScript kodunun kendisi
  // attığı bir hata; hangi pipeline aşamasından geldiği (open/save/apply
  // variables/...) değişebildiği için tek bir stage'e ait değil.
  JSX_EXECUTION_FAILED: 'JSX_001',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
