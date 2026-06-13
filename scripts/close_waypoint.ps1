#Requires -Version 5.1
$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "data\waypoint-pids.txt"
$stopped = 0

if (Test-Path $pidFile) {
    $ids = Get-Content $pidFile | Where-Object { $_ -match '^\d+$' }
    foreach ($id in $ids) {
        $proc = Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
            $stopped += 1
        }
    }
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

foreach ($port in @(8000, 5174)) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($owner in $owners) {
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        $stopped += 1
    }
}

Write-Output "Stopped Waypoint Core processes: $stopped"
