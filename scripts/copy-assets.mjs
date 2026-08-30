#!/usr/bin/env node
// tsc only compiles .ts files - it never copies the real ExtendScript
// (.jsx) files under src/jsx/ into dist/, even though the compiled JS
// resolves them at runtime relative to dist/ (e.g.
// dist/jsx/detect-capabilities.jsx). Run as part of `npm run build` so
// `node dist/main.js` actually finds them.
import { readdirSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..');
const srcDir = resolve(projectDir, 'src');
const distDir = resolve(projectDir, 'dist');

const ASSET_EXTENSIONS = new Set(['.jsx']);

function copyAssets(dir) {
  let copied = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      copied += copyAssets(fullPath);
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!ASSET_EXTENSIONS.has(ext)) {
      continue;
    }
    const destPath = join(distDir, relative(srcDir, fullPath));
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(fullPath, destPath);
    copied += 1;
  }
  return copied;
}

if (!statSync(srcDir, { throwIfNoEntry: false })) {
  console.error(`[copy-assets] src not found: ${srcDir}`);
  process.exit(1);
}

const count = copyAssets(srcDir);
console.log(`[copy-assets] copied ${count} file(s) to dist/ (${[...ASSET_EXTENSIONS].join(', ')})`);
