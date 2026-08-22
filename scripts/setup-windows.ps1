# One-time setup for a Windows render node: installs Node.js/cloudflared if
# missing (via winget), installs npm dependencies, builds the project, then
# hands off to configure.mjs for the interactive config.json prompts. Safe
# to re-run - every step checks "already installed?" first.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

Write-Host "== MotionCurate Render Node Kurulumu (Windows) ==" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget bulunamadı." -ForegroundColor Red
    Write-Host "Microsoft Store'dan 'App Installer'i güncelleyip bu script'i tekrar çalıştırın."
    exit 1
}

$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeMajor = [int]((node -v) -replace 'v', '').Split('.')[0]
    if ($nodeMajor -ge 22) { $nodeOk = $true }
}

if (-not $nodeOk) {
    Write-Host "Node.js 22+ kuruluyor (winget install OpenJS.NodeJS.LTS)..."
    winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    Write-Host ""
    Write-Host "Node.js kuruldu. PATH güncellemesi için bu terminali kapatip yeniden acin," -ForegroundColor Yellow
    Write-Host "sonra bu script'i tekrar calistirin." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "Node.js zaten kurulu: $(node -v)"
}

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "cloudflared kuruluyor (winget install Cloudflare.cloudflared)..."
    winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
} else {
    Write-Host "cloudflared zaten kurulu."
}

Write-Host ""
Write-Host "npm bagimliliklari kuruluyor..."
Set-Location $ProjectDir
npm install

Write-Host ""
Write-Host "Proje derleniyor (npm run build)..."
npm run build

Write-Host ""
node "$ScriptDir\configure.mjs"

Write-Host ""
Write-Host "== Siradaki adimlar (detaylar icin SETUP.md) ==" -ForegroundColor Cyan
Write-Host "1. Cloudflare Tunnel olusturmadiysan: SETUP.md adim 2."
Write-Host "2. Node'u Laravel'e kaydetmediysen: SETUP.md adim 3."
Write-Host "3. Her ikisi de tamamsa: npm start"
