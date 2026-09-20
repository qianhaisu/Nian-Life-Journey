$name = "Nianlife Nightly Editor"
$cmd = "C:\Users\teddy\Documents\Nianlife\v2\.data\nightly-editor.cmd"
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
$arg = '/c "' + $cmd + '"'
$act = New-ScheduledTaskAction -Execute "C:\Windows\System32\cmd.exe" -Argument $arg
$trg = New-ScheduledTaskTrigger -Daily -At "00:15"
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$pri = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $pri | Out-Null
$t = Get-ScheduledTask -TaskName $name
$i = Get-ScheduledTaskInfo -TaskName $name
"任务: $($t.TaskName)  状态: $($t.State)"
"下次运行: $($i.NextRunTime)"
"动作: $($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
"StartWhenAvailable=$($t.Settings.StartWhenAvailable)  限时=$($t.Settings.ExecutionTimeLimit)"
