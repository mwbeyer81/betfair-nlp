$Node      = "C:\Users\matth\AppData\Local\nvm\v22.22.2\node.exe"
$ServerDir = "C:\Users\matth\betfair-nlp"

function Test-Http($port) {
    try { (Invoke-WebRequest -Uri "http://localhost:$port/" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop).StatusCode -lt 500 }
    catch { $false }
}
function Test-Port($port) {
    try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect("127.0.0.1",$port); $c.Close(); $true }
    catch { $false }
}

# Wait for MongoDB to be ready
Write-Output "-> Waiting for MongoDB on 27019..."
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (Test-Port 27019) { Write-Output "OK MongoDB ready"; break }
    Start-Sleep 2
}

if (-not (Test-Port 27019)) {
    Write-Output "FAIL MongoDB not ready"
    exit 1
}

if (Test-Http 3000) {
    Write-Output "OK API server already on 3000"
    exit 0
}

Write-Output "-> Starting API server..."
Start-Process -FilePath $Node `
    -ArgumentList "$ServerDir\node_modules\ts-node-dev\lib\bin.js","--respawn","src/server/index.ts" `
    -WorkingDirectory $ServerDir -WindowStyle Hidden
Write-Output "SPAWNED - waiting up to 60s..."

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    Start-Sleep 3
    if (Test-Http 3000) { Write-Output "OK API server on 3000"; exit 0 }
}
Write-Output "FAIL API server not ready in 60s"
exit 1
