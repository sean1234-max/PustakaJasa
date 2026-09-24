# One-time setup: makes watch_ai_file_jobs.js start automatically (hidden,
# no console window) every time you log in — after running this once, you
# never need to open PowerShell/Terminal again to use the "Generate AI
# File" button on this computer.
#
# Usage (run once, from this folder, in PowerShell):
#   powershell -ExecutionPolicy Bypass -File setup_watcher_autostart.ps1

$ErrorActionPreference = "Stop"
$repoDir = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoDir ".env"
$scriptPath = Join-Path $PSScriptRoot "watch_ai_file_jobs.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if (-not $nodeCmd) {
    Write-Error "node not found on PATH -- install Node.js first (https://nodejs.org), then re-run this script."
    exit 1
}
if (-not (Test-Path $envFile)) {
    Write-Error "Missing $envFile -- copy .env.example to .env and fill in VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WATCHER_USER_EMAIL, and AI_FILE_DIR first."
    exit 1
}

$startupDir = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startupDir "ai-file-watcher.vbs"
$logPath = Join-Path $repoDir "ai-file-watcher.log"

# A hidden VBScript wrapper is the standard way to run something at login
# on Windows without a console window flashing up every time — a plain
# .bat in the Startup folder would show one.
$vbsContent = @"
Set objShell = CreateObject("WScript.Shell")
objShell.Run "cmd /c cd /d ""$repoDir"" && node --env-file=""$envFile"" ""$scriptPath"" >> ""$logPath"" 2>&1", 0, False
"@
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

# Start it now too, not just at next login.
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbsPath`"" -WindowStyle Hidden

Write-Host "Installed and started: $vbsPath"
Write-Host "It will now start automatically every time you log in -- no PowerShell needed."
Write-Host "Logs: Get-Content -Wait `"$logPath`""
Write-Host "To stop it permanently: delete `"$vbsPath`" and end the running 'node' process in Task Manager."
