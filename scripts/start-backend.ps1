# Start Docker backend directly (creates named pipe without GUI)
$BackendExe  = "C:\Program Files\Docker\Docker\resources\com.docker.backend.exe"
$DockerExe   = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$DockerPipe  = "\\.\pipe\dockerDesktopLinuxEngine"

function Test-Docker {
    try { $null = & $DockerExe ps 2>$null; $LASTEXITCODE -eq 0 } catch { $false }
}

if (Test-Docker) {
    Write-Output "OK Docker already running"
    exit 0
}

# Kill any stale backend processes first
Get-Process "com.docker.backend" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Output "-> Starting com.docker.backend.exe..."
$p = Start-Process -FilePath $BackendExe -WindowStyle Hidden -PassThru
Write-Output "Backend PID: $($p.Id)"

Write-Output "-> Waiting 60s for Docker named pipe + API..."
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    Start-Sleep 3
    if (Test-Path $DockerPipe) {
        Write-Output "  Named pipe appeared"
        Start-Sleep 2
    }
    if (Test-Docker) {
        Write-Output "OK Docker ready"
        & $DockerExe ps
        exit 0
    }
    Write-Output "  ...$(([int]($deadline - (Get-Date)).TotalSeconds))s remaining"
}
Write-Output "FAIL - checking processes:"
Get-Process "com.docker.backend","Docker Desktop" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, SessionId
exit 1
