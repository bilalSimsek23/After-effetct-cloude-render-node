#!/usr/bin/env node
// Cross-platform (Node itself, no extra dependency) interactive writer for
// config.json — called by both setup-mac.sh and setup-windows.ps1 after
// Node.js/cloudflared/npm dependencies are already installed, so the
// actual JSON-writing logic (with correct escaping) lives in exactly one
// place instead of being duplicated in bash and PowerShell.
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..');
const configPath = resolve(projectDir, 'config.json');

function readDirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function detectAfterEffects() {
  if (process.platform === 'darwin') {
    return (
      existsSync('/Applications') &&
      readDirSafe('/Applications').some((name) => name.startsWith('Adobe After Effects'))
    );
  }
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\Adobe';
    return existsSync(base) && readDirSafe(base).some((name) => name.startsWith('Adobe After Effects'));
  }
  return null;
}

async function ask(rl, question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || '';
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('== PratikTools Render Node - config.json Kurulumu ==\n');

  const aeFound = detectAfterEffects();
  if (aeFound === false) {
    console.warn(
      '[UYARI] Bu makinede Adobe After Effects bulunamadı - render node gerçek render işi yapamaz, sadece bağlanabilir/test edilebilir.\n',
    );
  }

  let existing = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      existing = {};
    }
  }

  const server = await ask(rl, 'Laravel server URL', existing.server || 'https://motioncurate.com');
  const nodeUuid = await ask(
    rl,
    "Node UUID (php artisan cloud-render:register-render-node çıktısından)",
    existing.nodeUuid && existing.nodeUuid !== 'CHANGE_ME' ? existing.nodeUuid : '',
  );
  const apiSecret = await ask(
    rl,
    'API Secret (aynı komutun çıktısından)',
    existing.apiSecret && existing.apiSecret !== 'CHANGE_ME' ? existing.apiSecret : '',
  );
  const nodeName = await ask(
    rl,
    'Node adı',
    existing.nodeName || `${process.platform === 'win32' ? 'Windows' : 'Mac'} Render Node`,
  );
  const pushPort = await ask(rl, 'Push server portu (Cloudflare Tunnel bunu hedefleyecek)', String(existing.pushServer?.port || 4790));
  const tunnelToken = await ask(
    rl,
    'Cloudflare Tunnel token (dashboard > Networks > Tunnels)',
    existing.pushServer?.tunnelToken && existing.pushServer.tunnelToken !== 'CHANGE_ME'
      ? existing.pushServer.tunnelToken
      : '',
  );
  const maxJobs = await ask(rl, 'Maksimum eşzamanlı iş sayısı', String(existing.maxConcurrentJobs || 1));

  rl.close();

  const config = {
    server,
    nodeUuid,
    apiSecret,
    nodeName,
    heartbeatInterval: existing.heartbeatInterval || 30,
    maxConcurrentJobs: parseInt(maxJobs, 10) || 1,
    agentVersion: existing.agentVersion || '1.0.0',
    engine: 'after-effects',
    supportedEngines: ['after-effects'],
    pushServer: {
      port: parseInt(pushPort, 10) || 4790,
      tunnelToken,
    },
    ...(existing.renderProfiles ? { renderProfiles: existing.renderProfiles } : {}),
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  console.log(`\nconfig.json yazıldı: ${configPath}`);

  const missing = [];
  if (!nodeUuid) missing.push('nodeUuid');
  if (!apiSecret) missing.push('apiSecret');
  if (!tunnelToken) missing.push('tunnelToken');
  if (missing.length > 0) {
    console.warn(
      `\n[UYARI] Şu alanlar boş bırakıldı: ${missing.join(', ')}. Node bunlar doldurulmadan başlamayacaktır - config.json'ı elle düzenleyip tekrar deneyebilir ya da bu script'i tekrar çalıştırabilirsin.`,
    );
  } else {
    console.log("\nHer şey hazır görünüyor. 'npm start' ile node'u başlatabilirsin.");
  }
}

main().catch((error) => {
  console.error('[HATA]', error.message);
  process.exitCode = 1;
});
