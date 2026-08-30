import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IAdobeBridge } from '../adobe/bridge/adobe-bridge.js';
import type { AdobeAppId } from '../adobe/models/adobe-app-id.js';
import type { JsxScriptName } from './jsx-script-name.js';
import type { Logger } from '../types/log.types.js';

const SCRIPTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export class JsxScriptNotFoundError extends Error {
  constructor(scriptName: string, scriptPath: string) {
    super(`JSX script not found: "${scriptName}" (${scriptPath})`);
    this.name = 'JsxScriptNotFoundError';
  }
}

export interface IJsxRuntimeService {
  runJsx(
    appId: AdobeAppId,
    scriptName: JsxScriptName,
    payload?: Record<string, unknown>,
  ): Promise<string>;
}

/**
 * The single entry point Node uses to drive Adobe automation: every real
 * operation lives in its own .jsx file under src/jsx/, never inlined as a
 * string in TypeScript. Node never reads or knows a script's content — it
 * only resolves the file by name, hands it a payload, and runs it.
 *
 * Implementation: `payload` is exposed to the included script as a global
 * `payload` object, then the real script file is pulled in via
 * ExtendScript's `#include` directive — reusing AdobeBridge's existing,
 * tested `runJsxCode()` (a single inline snippet), rather than adding a
 * second, parallel automation surface.
 */
export class JsxRuntimeService implements IJsxRuntimeService {
  constructor(
    private readonly bridge: IAdobeBridge,
    private readonly logger: Logger,
  ) {}

  async runJsx(
    appId: AdobeAppId,
    scriptName: JsxScriptName,
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    const scriptPath = resolve(SCRIPTS_DIRECTORY, scriptName);

    try {
      await access(scriptPath);
    } catch {
      throw new JsxScriptNotFoundError(scriptName, scriptPath);
    }

    // beginSuppressDialogs/endSuppressDialogs: real UAT found an uncaught
    // exception inside a script otherwise renders as AE's own blocking
    // "Unable to execute script..." native alert (requires a human to
    // click OK) instead of failing back to Node as a normal thrown error —
    // same fix as AfterEffectsEngine.suppressDialogs(), applied uniformly
    // here so every script run through this service is covered.
    //
    // #include's path is forward-slashed, not backslash-escaped: real
    // Windows testing (2026-08-30) found a raw Windows absolute path here
    // (e.g. "...\render-node-v2\...") corrupts the #include directive -
    // "\r" in the middle of a real path component is indistinguishable
    // from the carriage-return escape sequence to ExtendScript's
    // preprocessor, silently mangling the path into one that doesn't
    // exist. Forward slashes sidestep the ambiguity entirely and resolve
    // identically on Windows.
    const includeSafePath = scriptPath.replace(/\\/g, '/');
    const wrapperCode = `var payload = ${JSON.stringify(payload)};\napp.beginSuppressDialogs();\ntry {\n#include "${includeSafePath}"\n} finally {\n  app.endSuppressDialogs(false);\n}`;

    this.logger.debug('Running JSX script', { scriptName, scriptPath, payload });
    const result = await this.bridge.runJsxCode(appId, wrapperCode);
    this.logger.debug('JSX script completed', { scriptName, result });

    return result;
  }
}
