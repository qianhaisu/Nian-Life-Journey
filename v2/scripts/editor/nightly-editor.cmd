@echo off
rem Nianlife nightly editor (dry-run unless NIANLIFE_EDITOR_PUBLISH=1 is set below).
rem This file lives under .data/ and is not committed to Git.
rem Invoked by the Windows scheduled task "Nianlife Nightly Editor", 00:15, after the 23:30 WeChat sync.
rem
rem ASCII ONLY. The Task Scheduler console runs cmd.exe under codepage 936 (GBK); a non-ASCII byte in
rem this file breaks parsing (see daily-wechat-sync.cmd, 2026-09-16). Put explanations in
rem scripts\editor\nightly-editor.mjs instead.
rem
rem Do NOT clear HTTP_PROXY/HTTPS_PROXY here: this machine reaches Anthropic through the local proxy
rem (127.0.0.1:7994); clearing it makes claude return a fake 403.
cd /d C:\Users\teddy\Documents\Nianlife\v2
if not exist C:\Users\teddy\NianlifeOps\ops-daily\logs mkdir C:\Users\teddy\NianlifeOps\ops-daily\logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
set PATH=%PATH%;C:\Users\teddy\AppData\Roaming\npm;C:\Program Files\nodejs;C:\Windows\System32\OpenSSH
rem Publishing turned ON 2026-09-20 at Teddy's explicit instruction (before any multi-night spot check).
rem To turn it off again, change the next line to: set NIANLIFE_EDITOR_PUBLISH=0
set NIANLIFE_EDITOR_PUBLISH=1
"C:\Program Files\nodejs\node.exe" --import tsx scripts\editor\nightly-editor.mjs >> C:\Users\teddy\NianlifeOps\ops-daily\logs\editor-%STAMP%.log 2>&1
echo exit=%ERRORLEVEL% >> C:\Users\teddy\NianlifeOps\ops-daily\logs\editor-%STAMP%.log
set EDITOR_EXIT=%ERRORLEVEL%
rem Weekly reminders (added 2026-09-20): extract new todos with DeepSeek, then auto-approve them (Teddy chose
rem full automation). Independent of the month editor above: either can fail without stopping the other.
rem Needs the DB tunnel + env, so it goes through t20-run-env.mjs like the WeChat sync does.
"C:\Program Files\nodejs\node.exe" --env-file=.env.local .data\t20-run-env.mjs -- scripts\editor\nightly-reminders.mjs >> C:\Users\teddy\NianlifeOps\ops-daily\logs\reminders-%STAMP%.log 2>&1
echo exit=%ERRORLEVEL% >> C:\Users\teddy\NianlifeOps\ops-daily\logs\reminders-%STAMP%.log
set REMINDERS_EXIT=%ERRORLEVEL%
if not "%EDITOR_EXIT%"=="0" exit /b %EDITOR_EXIT%
exit /b %REMINDERS_EXIT%
