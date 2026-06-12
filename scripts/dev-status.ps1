# dev-status.ps1 — Report betfair-nlp service status
$DockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

function Test-Http($port) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$port/" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return $r.StatusCode -lt 500
    } catch { return $false }
}

function Test-Port27019 {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", 27019)
        $c.Close()
        return $true
    } catch { return $false }
}

function Test-Docker {
    try { & $DockerExe ps > $null 2>&1; return $LASTEXITCODE -eq 0 } catch { return $false }
}

$docker  = if (Test-Docker)      { "UP" } else { "DOWN" }
$mongo   = if (Test-Port27019)   { "UP" } else { "DOWN" }
$api     = if (Test-Http 3000)   { "UP" } else { "DOWN" }
$expo    = if (Test-Http 8081)   { "UP" } else { "DOWN" }
$story   = if (Test-Http 6006)   { "UP" } else { "DOWN" }

Write-Output "Docker Desktop : $docker"
Write-Output "MongoDB (27019): $mongo"
Write-Output "API server (3000): $api"
Write-Output "Expo web   (8081): $expo"
Write-Output "Storybook  (6006): $story"
