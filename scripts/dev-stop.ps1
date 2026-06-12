# dev-stop.ps1 -- stop betfair-nlp server, Expo, and MongoDB Task Scheduler tasks

foreach ($taskName in @('betfair-MongoDB', 'betfair-APIServer', 'betfair-ExpoWeb')) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Write-Output "Stopped task: $taskName"
    }
}

$procs = Get-WmiObject Win32_Process | Where-Object {
    $_.CommandLine -like "*ts-node-dev*" -or
    $_.CommandLine -like "*expo*bin*cli*" -or
    ($_.Name -eq 'mongod.exe' -and $_.CommandLine -like "*mongodb*data*")
}
if ($procs) {
    foreach ($p in $procs) {
        Write-Output "Killing PID $($p.ProcessId): $($p.Name)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Output "OK processes killed"
} else {
    Write-Output "No betfair-nlp dev processes found"
}
