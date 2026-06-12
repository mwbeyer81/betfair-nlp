# dev-start.ps1 -- start betfair-nlp services headlessly and return immediately
# All processes via Task Scheduler (SYSTEM, survives SSH disconnect, no GUI required).
# MongoDB: Windows-native mongod.exe 7.0.17 at C:\Users\matth\mongodb\

$Node      = "C:\Users\matth\AppData\Local\nvm\v22.22.2\node.exe"
$ServerDir = "C:\Users\matth\betfair-nlp"
$ClientDir = "C:\Users\matth\betfair-nlp\client"
$TsNodeDev = "$ServerDir\node_modules\ts-node-dev\lib\bin.js"
$ExpoCli   = "$ClientDir\node_modules\expo\bin\cli"
$MongodExe = "C:\Users\matth\mongodb\mongod.exe"
$MongoData = "C:\Users\matth\mongodb\data"
$MongoLog  = "C:\Users\matth\mongodb\mongod.log"

function Test-Port($port) {
    try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect("127.0.0.1", $port); $t.Close(); $true }
    catch { $false }
}

function Start-TaskSchedulerProcess($TaskName, $Command, $Arguments, $WorkingDirectory) {
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT24H</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
  </Settings>
  <Triggers><TimeTrigger><StartBoundary>2000-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>$Command</Command>
      <Arguments>$Arguments</Arguments>
      <WorkingDirectory>$WorkingDirectory</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
    Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force 2>&1 | Out-Null
    Start-ScheduledTask -TaskName $TaskName
}

# -- Step 1: MongoDB (Windows-native mongod.exe) --
Write-Output "-> Step 1: MongoDB"

if (-not (Test-Port 27017)) {
    Write-Output "   Starting mongod.exe via Task Scheduler..."
    New-Item -ItemType Directory -Path $MongoData -Force | Out-Null
    $mongoArgs = "--dbpath `"$MongoData`" --logpath `"$MongoLog`" --port 27017 --bind_ip 127.0.0.1"
    Start-TaskSchedulerProcess "betfair-MongoDB" $MongodExe $mongoArgs ""
    Start-Sleep 5
    if (Test-Port 27017) { Write-Output "   OK MongoDB on 27017" }
    else { Write-Output "   WARN MongoDB not responding" }
} else {
    Write-Output "   OK MongoDB already on 27017"
}

# -- Step 2: API server --
Write-Output "-> Step 2: API server"

if (-not (Test-Port 3000)) {
    Write-Output "   Starting API server via Task Scheduler..."
    Start-TaskSchedulerProcess "betfair-APIServer" $Node "`"$TsNodeDev`" src/server/index.ts" $ServerDir
    Write-Output "   Task started (port 3000 ready in ~10s)"
} else {
    Write-Output "   OK API server already on 3000"
}

# -- Step 3: Expo web --
Write-Output "-> Step 3: Expo web"

if (-not (Test-Port 8081)) {
    Write-Output "   Starting Expo web via Task Scheduler..."
    Start-TaskSchedulerProcess "betfair-ExpoWeb" $Node "`"$ExpoCli`" start --web" $ClientDir
    Write-Output "   Task started (port 8081 ready in ~60s)"
} else {
    Write-Output "   OK Expo already on 8081"
}

Write-Output "DONE - poll from Pi for readiness"
