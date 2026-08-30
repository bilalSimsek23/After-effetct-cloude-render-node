# One-time setup for a Windows render node: installs Node.js/cloudflared if
# missing (via winget), installs npm dependencies, builds the project, then
# hands off to configure.mjs for the interactive config.json prompts. Safe
# to re-run - every step checks "already installed?" first.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

Write-Host "== MotionCurate Render Node Setup (Windows) ==" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget was not found." -ForegroundColor Red
    Write-Host "Update 'App Installer' from the Microsoft Store, then run this script again."
    exit 1
}

$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeMajor = [int]((node -v) -replace 'v', '').Split('.')[0]
    if ($nodeMajor -ge 22) { $nodeOk = $true }
}

if (-not $nodeOk) {
    Write-Host "Installing Node.js 22+ (winget install OpenJS.NodeJS.LTS)..."
    winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    Write-Host ""
    Write-Host "Node.js installed. Close this terminal and open a new one so PATH updates," -ForegroundColor Yellow
    Write-Host "then run this script again." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "Node.js is already installed: $(node -v)"
}

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "Installing cloudflared (winget install Cloudflare.cloudflared)..."
    winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
} else {
    Write-Host "cloudflared is already installed."
}

Write-Host ""
Write-Host "Installing npm dependencies..."
Set-Location $ProjectDir
npm install

Write-Host ""
Write-Host "Building the project (npm run build)..."
npm run build

Write-Host ""
node "$ScriptDir\configure.mjs"

Write-Host ""
Write-Host "== Next steps (see SETUP.md for details) ==" -ForegroundColor Cyan
Write-Host "1. If you haven't created a Cloudflare Tunnel yet: SETUP.md step 2."
Write-Host "2. If you haven't registered the node with Laravel yet: SETUP.md step 3."
Write-Host "3. Once both are done: npm start"
