#!/usr/bin/env bash
# One-time setup for a Mac render node: installs Node.js/cloudflared if
# missing, installs npm dependencies, builds the project, then hands off to
# configure.mjs for the interactive config.json prompts. Safe to re-run —
# every step checks "already installed?" first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "== MotionCurate Render Node Setup (macOS) =="
echo ""

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew was not found."
  echo "Install it first from: https://brew.sh"
  echo "Then run this script again."
  exit 1
fi

NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 22 ]; then
    NODE_OK=1
  fi
fi

if [ "$NODE_OK" -eq 0 ]; then
  echo "Installing Node.js 22+ (brew install node)..."
  brew install node
else
  echo "Node.js is already installed: $(node -v)"
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared (brew install cloudflared)..."
  brew install cloudflared
else
  echo "cloudflared is already installed: $(cloudflared --version)"
fi

echo ""
echo "Installing npm dependencies..."
cd "$PROJECT_DIR"
npm install

echo ""
echo "Building the project (npm run build)..."
npm run build

echo ""
node "$SCRIPT_DIR/configure.mjs"

echo ""
echo "== Next steps (see SETUP.md for details) =="
echo "1. If you haven't created a Cloudflare Tunnel yet: SETUP.md step 2."
echo "2. If you haven't registered the node with Laravel yet: SETUP.md step 3."
echo "3. Once both are done: npm start"
