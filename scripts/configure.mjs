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

  console.log('== MotionCurate Render Node - config.json Setup ==\n');

  const aeFound = detectAfterEffects();
  if (aeFound === false) {
    console.warn(
      '[WARNING] Adobe After Effects was not found on this machine - the render node can connect/be tested, but cannot run real render jobs.\n',
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

  const alreadyHasCredentials =
    existing.nodeUuid && existing.nodeUuid !== 'CHANGE_ME' && existing.apiSecret && existing.apiSecret !== 'CHANGE_ME';

  let nodeUuid = existing.nodeUuid && existing.nodeUuid !== 'CHANGE_ME' ? existing.nodeUuid : '';
  let apiSecret = existing.apiSecret && existing.apiSecret !== 'CHANGE_ME' ? existing.apiSecret : '';
  let registeredNodeName = null;

  if (!alreadyHasCredentials) {
    // Faz 2 (Author <-> Render Node Ownership) - self-service path. A
    // registration token (from the MotionCurate author panel's "Render
    // Node Ekle" button) replaces manually copy-pasting a UUID/secret an
    // admin generated via `cloud-render:register-render-node` - that CLI
    // path still works unchanged for platform-owned nodes (leave this
    // blank and enter the UUID/secret manually below, same as before).
    const registrationToken = await ask(
      rl,
      'Registration Token (from "Add Render Node" in the author panel - leave blank if an admin already gave you a UUID/Secret)',
      '',
    );

    if (registrationToken) {
      const nodeName = await ask(rl, 'Node name', existing.nodeName || `${process.platform === 'win32' ? 'Windows' : 'Mac'} Render Node`);

      console.log('\nRegistering...');
      try {
        const response = await fetch(`${server}/api/render-nodes/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationToken, nodeName }),
        });
        const body = await response.json().catch(() => null);

        if (!response.ok || !body?.nodeUuid || !body?.apiSecret) {
          throw new Error(body?.message || `HTTP ${response.status}`);
        }

        nodeUuid = body.nodeUuid;
        apiSecret = body.apiSecret;
        registeredNodeName = nodeName;
        console.log(`Registration successful - node UUID: ${nodeUuid}\n`);
        // apiSecret is intentionally never logged here - it goes straight
        // into config.json below.
      } catch (error) {
        console.error(`\n[ERROR] Registration failed: ${error.message}`);
        console.error('You can also enter the UUID/Secret fields manually with the values an admin gave you.\n');
      }
    }
  }

  if (!nodeUuid) {
    nodeUuid = await ask(
      rl,
      'Node UUID (from the output of php artisan cloud-render:register-render-node)',
      existing.nodeUuid && existing.nodeUuid !== 'CHANGE_ME' ? existing.nodeUuid : '',
    );
  }
  if (!apiSecret) {
    apiSecret = await ask(
      rl,
      'API Secret (from the same command\'s output)',
      existing.apiSecret && existing.apiSecret !== 'CHANGE_ME' ? existing.apiSecret : '',
    );
  }
  const nodeName = await ask(
    rl,
    'Node name',
    registeredNodeName || existing.nodeName || `${process.platform === 'win32' ? 'Windows' : 'Mac'} Render Node`,
  );
  const pushPort = await ask(rl, 'Push server port (your Cloudflare Tunnel will target this)', String(existing.pushServer?.port || 4790));
  const tunnelToken = await ask(
    rl,
    'Cloudflare Tunnel token (dashboard > Networks > Tunnels)',
    existing.pushServer?.tunnelToken && existing.pushServer.tunnelToken !== 'CHANGE_ME'
      ? existing.pushServer.tunnelToken
      : '',
  );
  const maxJobs = await ask(rl, 'Maximum concurrent jobs', String(existing.maxConcurrentJobs || 1));
  const autoUpdateAnswer = await ask(
    rl,
    'Enable automatic updates? (periodically checks the main branch on GitHub and updates itself when the node is idle) [yes/no]',
    existing.autoUpdate?.enabled === false ? 'no' : 'yes',
  );
  const autoUpdateEnabled = !/^n/i.test(autoUpdateAnswer.trim());

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
    autoUpdate: {
      enabled: autoUpdateEnabled,
      checkIntervalMinutes: existing.autoUpdate?.checkIntervalMinutes || 60,
      branch: existing.autoUpdate?.branch || 'main',
    },
    pushServer: {
      port: parseInt(pushPort, 10) || 4790,
      tunnelToken,
    },
    ...(existing.renderProfiles ? { renderProfiles: existing.renderProfiles } : {}),
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  console.log(`\nconfig.json written: ${configPath}`);

  const missing = [];
  if (!nodeUuid) missing.push('nodeUuid');
  if (!apiSecret) missing.push('apiSecret');
  if (!tunnelToken) missing.push('tunnelToken');
  if (missing.length > 0) {
    console.warn(
      `\n[WARNING] The following fields were left blank: ${missing.join(', ')}. The node will not start until they are filled in - you can edit config.json by hand and try again, or re-run this script.`,
    );
  } else {
    console.log("\nEverything looks ready. You can start the node with 'npm start'.");
  }
}

main().catch((error) => {
  console.error('[ERROR]', error.message);
  process.exitCode = 1;
});
