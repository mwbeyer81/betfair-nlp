# spawn-backend.ps1 -- spawn Docker backend and return immediately (no wait loop)
$BackendExe = "C:\Program Files\Docker\Docker\resources\com.docker.backend.exe"
Get-Process "com.docker.backend" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
$p = Start-Process -FilePath $BackendExe -WindowStyle Hidden -PassThru
Write-Output "SPAWNED $($p.Id)"
