#!/usr/bin/env bash
# One-time setup for a Mac render node: installs Node.js/cloudflared if
# missing, installs npm dependencies, builds the project, then hands off to
# configure.mjs for the interactive config.json prompts. Safe to re-run —
# every step checks "already installed?" first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "== MotionCurate Render Node Kurulumu (macOS) =="
echo ""

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew bulunamadı."
  echo "Önce şu adresten kurun: https://brew.sh"
  echo "Sonra bu script'i tekrar çalıştırın."
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
  echo "Node.js 22+ kuruluyor (brew install node)..."
  brew install node
else
  echo "Node.js zaten kurulu: $(node -v)"
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared kuruluyor (brew install cloudflared)..."
  brew install cloudflared
else
  echo "cloudflared zaten kurulu: $(cloudflared --version)"
fi

echo ""
echo "npm bağımlılıkları kuruluyor..."
cd "$PROJECT_DIR"
npm install

echo ""
echo "Proje derleniyor (npm run build)..."
npm run build

echo ""
node "$SCRIPT_DIR/configure.mjs"

echo ""
echo "== Sıradaki adımlar (detaylar için SETUP.md) =="
echo "1. Cloudflare Tunnel oluşturmadıysan: SETUP.md adım 2."
echo "2. Node'u Laravel'e kaydetmediysen: SETUP.md adım 3."
echo "3. Her ikisi de tamamsa: npm start"
