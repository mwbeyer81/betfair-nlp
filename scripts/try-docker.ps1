# try-docker.ps1 -- start docker-desktop WSL2 distro headlessly
$DockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

function Test-Docker {
    try { $null = & $DockerExe ps 2>$null; $LASTEXITCODE -eq 0 } catch { $false }
}

if (Test-Docker) {
    Write-Output "OK Docker already running"
    exit 0
}

Write-Output "-> Starting docker-desktop WSL2 distro..."
$p = Start-Process -FilePath "wsl.exe" `
    -ArgumentList "--distribution","docker-desktop","--exec","/sbin/init" `
    -WindowStyle Hidden -PassThru
Write-Output "WSL PID: $($p.Id)"

Write-Output "-> Waiting 60s for Docker daemon..."
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    Start-Sleep 5
    if (Test-Docker) { Write-Output "OK Docker ready"; exit 0 }
    Write-Output "  ...still waiting"
}
Write-Output "FAIL Docker not ready after 60s"
exit 1
