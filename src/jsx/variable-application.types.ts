import { ErrorCode } from '../errors/error-code.js';
import { RenderNodeError } from '../errors/render-node-error.js';

/**
 * Every variable type the Essential Graphics binding supports. An
 * unrecognized manifest type is a hard failure (UnsupportedVariableTypeError),
 * never a silent skip — resolved and enforced on the Node side, before any
 * JSX ever runs, so a bad manifest never wastes a real Adobe round-trip.
 */
export const VariableType = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  COLOR: 'COLOR',
  ANGLE: 'ANGLE',
  POINT2D: 'POINT2D',
  POINT3D: 'POINT3D',
  DROPDOWN: 'DROPDOWN',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
} as const;

export type VariableType = (typeof VariableType)[keyof typeof VariableType];

/**
 * One manifest variable, fully resolved (real value substituted, type
 * normalized) — the only shape apply-variables.jsx ever reads.
 *
 * Faz 8C — this addressing scheme is the Render Node's side of a
 * documented Scanner↔Render Node contract (see
 * docs/scanner-manifest-metadata-contract.md), aligned with the real,
 * production `generate_manifest.jsx`/`apply_manifest.jsx` reference
 * implementation the Scanner side already uses (Essential Graphics is
 * the real variable-discovery mechanism there — `essentialPropertySource`
 * resolved via nesting the source comp as a layer in a throwaway sandbox
 * to reach its "ADBE Layer Overrides" group; this Render Node never needs
 * to know that — by the time a manifest reaches here, discovery is
 * already done).
 *
 * `compositionName` + `layerName` + `propertyPath` mirror the reference's
 * `ae.composition`/`ae.layer`/`ae.propertyPath` exactly — composition is
 * required so identically-named layers in different comps are never
 * confused (a real ambiguity the reference implementation also guards
 * against). `propertyPath` is an array (not the reference's slash-joined
 * string) per explicit approval — avoids parsing and safely supports
 * names containing "/". `propertyMatchName` is optional and enables the
 * exact fallback the reference implementation already runs in production
 * (see PropertyResolver in apply-variables.jsx): propertyPath first, then
 * a recursive matchName+displayName search, keeping the first matchName
 * hit if no displayName also matches. `propertyPath` is empty for IMAGE/
 * VIDEO/AUDIO, which bind to the layer itself via ReplaceSource, not a
 * property.
 */
export interface ResolvedVariableEntry {
  key: string;
  type: VariableType;
  value: unknown;
  compositionName: string;
  layerName: string;
  propertyPath: string[];
  propertyMatchName: string | null;
}

/** What apply-variables.jsx reports back after a real run — read from a real file, never inferred from DoScript's own return value (see Faz 5: DoScript returns a status code, not the script's last expression). */
export interface VariableApplicationReport {
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

export class UnsupportedVariableTypeError extends RenderNodeError {
  constructor(
    public readonly type: string,
    public readonly key: string,
  ) {
    super(
      ErrorCode.VARIABLE_UNSUPPORTED_TYPE,
      `Unsupported variable type: "${type}" (key="${key}")`,
      { type, key },
    );
  }
}

/**
 * A manifest variable is missing the real AE property address
 * (`metadata.layerName` / `metadata.propertyPath`) PropertyResolver needs
 * — rejected here, before any Adobe round-trip, for the same reason
 * UnsupportedVariableTypeError is: a bad manifest should never waste a
 * real Adobe session.
 */
export class PropertyAddressResolutionError extends RenderNodeError {
  constructor(
    public readonly key: string,
    reason: string,
  ) {
    super(
      ErrorCode.VARIABLE_ADDRESS_RESOLUTION_FAILED,
      `Variable address could not be resolved (key="${key}"): ${reason}`,
      { key, reason },
    );
  }
}

export class VariableApplicationError extends RenderNodeError {
  constructor(public readonly report: VariableApplicationReport) {
    super(
      ErrorCode.VARIABLE_APPLICATION_FAILED,
      `Variable application failed: ${report.failedCount} error(s) — ${report.errors.join('; ')}`,
      { report },
    );
  }
}

export class ProjectOpenError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.PROJECT_OPEN_FAILED, message, context);
  }
}

/** Renamed from MediaEncoderQueueError in Faz 8B — rendering no longer goes through Media Encoder (see AfterEffectsRenderEngine). */
export class RenderQueueError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.RENDER_QUEUE_FAILED, message, context);
  }
}

/**
 * Faz 3A — render settings (today: a named renderComposition that doesn't
 * exist in the project) failed validation before queueing. Distinct from
 * RenderQueueError (a genuine queueing/transport failure) so this specific,
 * "never silently render a different composition" case is classifiable on
 * its own — see queue-media-encoder.jsx's RENDER_COMPOSITION_NOT_FOUND check,
 * which this wraps.
 */
export class RenderConfigurationError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.RENDER_CONFIGURATION_INVALID, message, context);
  }
}

export class RenderTimeoutError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.RENDER_TIMEOUT, message, context);
  }
}

export class RenderFailedError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.RENDER_FAILED, message, context);
  }
}

export class OutputValidationError extends RenderNodeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.RENDER_OUTPUT_VALIDATION_FAILED, message, context);
  }
}
