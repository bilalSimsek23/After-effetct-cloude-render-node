import { readFile } from 'node:fs/promises';

/**
 * Shared by both platform bridges (AdobeBridge/macOS, WindowsAdobeBridge).
 * Neither AppleScript's DoScript nor AfterFX.exe's `-r` flag has a
 * trustworthy way to hand a script's real result/error back to the calling
 * process (see AdobeBridge's own docblock for the empirical macOS finding;
 * Windows has no documented result channel at all) - so both platforms wrap
 * arbitrary JSX in the same real `try/catch`, letting the exception be
 * caught *inside* ExtendScript and written to a file Node reads right
 * after, instead of ever crossing back out as the host app's own native
 * "Unable to execute script..." dialog.
 */
export function withJsxErrorBoundary(jsxCode: string, errorFilePath: string): string {
  return (
    `try {\n${jsxCode}\n} catch (__bridgeError) {\n` +
    // File#open()/#write() return a boolean instead of throwing on failure,
    // so their result is checked here rather than assumed - this file is
    // the only channel this bridge has for surfacing a script's real error
    // back to Node, and a silent write failure here would otherwise look
    // indistinguishable from "the script actually succeeded".
    `  var __bridgeErrorFile = new File(${JSON.stringify(errorFilePath)});\n` +
    `  if (__bridgeErrorFile.open('w')) {\n` +
    `    __bridgeErrorFile.write(__bridgeError && __bridgeError.message ? __bridgeError.message : String(__bridgeError));\n` +
    `    __bridgeErrorFile.close();\n` +
    `  }\n` +
    `}`
  );
}

export async function readJsxErrorFile(errorFilePath: string): Promise<string | null> {
  try {
    const content = await readFile(errorFilePath, 'utf-8');
    return content.trim();
  } catch {
    return null;
  }
}
