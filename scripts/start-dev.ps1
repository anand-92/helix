$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# Load .env
$envFile = Join-Path $RepoRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
        }
    }
}

# Kill anything on ports 8000 and 5173
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# Clear/create log files in logs/
$null = New-Item -ItemType Directory -Path ".\logs" -Force
"" | Set-Content ".\logs\backend.log"
"" | Set-Content ".\logs\backend-err.log"
"" | Set-Content ".\logs\frontend.log"
"" | Set-Content ".\logs\frontend-err.log"

# Start backend
$backendProc = Start-Process -NoNewWindow -PassThru -FilePath "uv" -ArgumentList "run python python/server.py" `
    -RedirectStandardOutput ".\logs\backend.log" -RedirectStandardError ".\logs\backend-err.log"

# Start frontend (npm is a .ps1 script on Windows, must use cmd /c)
$frontendProc = Start-Process -NoNewWindow -PassThru -FilePath "cmd.exe" -ArgumentList "/c npm --prefix frontend run dev -- --host 127.0.0.1" `
    -RedirectStandardOutput ".\logs\frontend.log" -RedirectStandardError ".\logs\frontend-err.log"

Write-Host "Backend starting on http://127.0.0.1:8000  (PID $($backendProc.Id))"
Write-Host "Frontend starting on http://127.0.0.1:5173  (PID $($frontendProc.Id))"
Write-Host "Waiting for services..."
Start-Sleep -Seconds 8

# Health check
try { Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 10 | Out-Null; Write-Host "Backend:  OK" } catch { Write-Host "Backend:  FAILED" }
try { Invoke-WebRequest -Uri "http://127.0.0.1:5173"          -UseBasicParsing -TimeoutSec 10 | Out-Null; Write-Host "Frontend: OK" } catch { Write-Host "Frontend: FAILED" }

Write-Host ""
Write-Host "--- Streaming logs (Ctrl+C to stop) ---"
Write-Host ""

# Track read position per file so we only print new lines
$bePos  = 0
$bePosE = 0
$fePos  = 0
$fePosE = 0

function Read-NewLines {
    param($Path, [ref]$Position, $Prefix, $Color)
    if (-not (Test-Path $Path)) { return }
    $content = Get-Content $Path -Raw -ErrorAction SilentlyContinue
    if (-not $content) { return }
    $lines = $content -split "`n"
    for ($i = $Position.Value; $i -lt $lines.Count; $i++) {
        $line = $lines[$i].TrimEnd("`r")
        if ($line -ne "") { Write-Host "[$Prefix] $line" -ForegroundColor $Color }
    }
    $Position.Value = $lines.Count
}

try {
    while ($true) {
        Read-NewLines ".\logs\backend.log"     ([ref]$bePos)  "BE"     "Cyan"
        Read-NewLines ".\logs\backend-err.log" ([ref]$bePosE) "BE ERR" "Red"
        Read-NewLines ".\logs\frontend.log"    ([ref]$fePos)  "FE"     "Green"
        Read-NewLines ".\logs\frontend-err.log"([ref]$fePosE) "FE ERR" "Yellow"
        Start-Sleep -Milliseconds 500
    }
} finally {
    Write-Host ""
    Write-Host "Stopping services..."
    Stop-Process -Id $backendProc.Id  -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
}
