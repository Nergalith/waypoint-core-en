#Requires -Version 5.1
param(
    [switch]$NoBrowser,
    [switch]$SkipInstall
)
$ErrorActionPreference = "Stop"

try { $Host.UI.RawUI.WindowTitle = "Waypoint Core EN - Test Build" } catch {}

$root     = Split-Path -Parent $PSScriptRoot
$backend  = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$dataDir  = Join-Path $root "data"
$pidFile  = Join-Path $dataDir "waypoint-pids.txt"
$python   = Join-Path $backend ".venv\Scripts\python.exe"
$npmCmd   = "npm.cmd"

function Stop-PortOwner($port) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($owner in $owners) {
        try {
            $proc = Get-Process -Id $owner -ErrorAction Stop
            Write-Host "Stopping existing process on port $port (PID $owner, $($proc.ProcessName))..." -ForegroundColor Yellow
            Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        } catch {}
    }
}

function Run-Step($message, $filePath, $arguments, $workingDirectory) {
    Write-Host $message -ForegroundColor Cyan
    $proc = Start-Process -FilePath $filePath -ArgumentList $arguments -WorkingDirectory $workingDirectory -Wait -PassThru -NoNewWindow
    if ($proc.ExitCode -ne 0) {
        throw "$message failed with exit code $($proc.ExitCode)."
    }
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Waypoint Core EN - Test Build" -ForegroundColor Cyan
Write-Host "  Local-first | English | Offline test map | Low-spec PCs" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] npm not found. Install Node.js LTS from https://nodejs.org" -ForegroundColor Red
    Read-Host "`nPress Enter to exit"
    exit 1
}

if (-not (Test-Path $python)) {
    if ($SkipInstall) {
        Write-Host "[ERROR] Backend .venv is missing and -SkipInstall was used." -ForegroundColor Red
        exit 1
    }
    $py = Get-Command py -ErrorAction SilentlyContinue
    if (-not $py) {
        Write-Host "[ERROR] Python launcher 'py' not found. Install Python 3.11+ first." -ForegroundColor Red
        Read-Host "`nPress Enter to exit"
        exit 1
    }
    Run-Step "[setup] Creating backend virtual environment" "py" @("-m", "venv", ".venv") $backend
}

if (-not $SkipInstall) {
    Run-Step "[setup] Installing backend requirements" $python @("-m", "pip", "install", "-r", "requirements.txt") $backend
    if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
        Run-Step "[setup] Installing frontend packages" $npmCmd @("install") $frontend
    }
}

Stop-PortOwner 8000
Stop-PortOwner 5173

Write-Host "[1/2] Backend   ->  http://127.0.0.1:8000" -ForegroundColor Green
$beProc = Start-Process -FilePath $python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $backend `
    -PassThru

Write-Host "[2/2] Frontend  ->  http://127.0.0.1:5173" -ForegroundColor Green
$feProc = Start-Process -FilePath $npmCmd `
    -ArgumentList "run", "dev", "--", "--host", "127.0.0.1" `
    -WorkingDirectory $frontend `
    -PassThru

Set-Content -Path $pidFile -Value @($beProc.Id, $feProc.Id) -Encoding ASCII

Write-Host ""
Write-Host "  Backend PID  : $($beProc.Id)"
Write-Host "  Frontend PID : $($feProc.Id)"
Write-Host "  Close with 'Close Waypoint Core.vbs' or Ctrl+C in this window."
Write-Host ""

Start-Sleep -Seconds 4
try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 5 | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173" -TimeoutSec 5 | Out-Null
} catch {
    Write-Host "[WARN] One service did not answer yet. Wait a few seconds, then refresh the browser." -ForegroundColor Yellow
}

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:5173"
} else {
    Write-Host "  NoBrowser mode - open http://127.0.0.1:5173 manually"
}

try {
    while ($true) {
        Start-Sleep -Seconds 2
        if ($beProc.HasExited) { Write-Host "`n[Backend] exited (code $($beProc.ExitCode))" -ForegroundColor Red; break }
        if ($feProc.HasExited) { Write-Host "`n[Frontend] exited" -ForegroundColor Red; break }
    }
} finally {
    Write-Host "`nStopping Waypoint Core..." -ForegroundColor Yellow
    if ($beProc -and -not $beProc.HasExited) { Stop-Process -Id $beProc.Id -Force -ErrorAction SilentlyContinue }
    if ($feProc -and -not $feProc.HasExited) { Stop-Process -Id $feProc.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
    Write-Host "Done." -ForegroundColor Green
}

