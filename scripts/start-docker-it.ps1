# Start Docker Desktop in the user's interactive session via Task Scheduler /IT flag
$DockerExe  = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$DockerApp  = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$TaskName   = "betfair-StartDockerIT"

function Test-Docker {
    try { $null = & $DockerExe ps 2>$null; $LASTEXITCODE -eq 0 } catch { $false }
}

if (Test-Docker) {
    Write-Output "OK Docker already running"
    exit 0
}

Write-Output "-> Registering Task Scheduler task with /IT (interactive user session)..."
schtasks /Create /TN $TaskName /TR "`"$DockerApp`"" /SC ONCE /ST "00:00" /RU "matth" /IT /F 2>&1 | Write-Output
Write-Output "-> Running task..."
schtasks /Run /TN $TaskName 2>&1 | Write-Output

Write-Output "-> Waiting up to 120s for Docker named pipe..."
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
    Start-Sleep 5
    # Check named pipe directly
    $pipe = Test-Path "\\.\pipe\dockerDesktopLinuxEngine"
    if ($pipe) { Write-Output "  Pipe found!"; break }
    if (Test-Docker) { Write-Output "  Docker responding!"; break }
    Write-Output "  ...$(([int]($deadline - (Get-Date)).TotalSeconds))s remaining"
}

if (Test-Docker) {
    Write-Output "OK Docker ready"
    exit 0
} else {
    Write-Output "FAIL Docker not ready after 120s"
    exit 1
}
