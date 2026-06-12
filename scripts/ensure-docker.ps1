# ensure-docker.ps1 — Start Docker Desktop via Task Scheduler (user session)
$DockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$DockerApp = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$StartBat  = "C:\Users\matth\betfair-nlp\scripts\start-docker.bat"

function Test-Docker {
    try { & $DockerExe ps 2>$null | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

if (Test-Docker) {
    Write-Output "OK Docker already running"
    exit 0
}

Write-Output "-> Registering Docker Desktop task..."
schtasks /Create /TN "betfair-StartDockerDesktop" /TR $StartBat /SC ONCE /ST "00:00" /RU "matth" /F
schtasks /Run /TN "betfair-StartDockerDesktop"

Write-Output "-> Waiting for Docker daemon (up to 90s)..."
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    if (Test-Docker) { Write-Output "OK Docker ready"; exit 0 }
    Start-Sleep 5
}
Write-Output "WARN Docker did not start - start Docker Desktop manually if needed"
