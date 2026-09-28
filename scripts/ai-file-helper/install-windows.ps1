# Installs the AI File helper on this Windows computer: copies it to
# %LOCALAPPDATA%\PustakaJasa-AI-Helper, starts it now, and starts it hidden
# at every login (Startup folder). Run via install-windows.bat (double-click).
# ASCII only on purpose: Windows PowerShell 5.1 misreads a UTF-8 .ps1 that
# has no BOM, so Chinese text here would break the script.
$ErrorActionPreference = "Stop"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js is not installed. Install it from https://nodejs.org (LTS), then run this again."
    exit 1
}

$dest = Join-Path $env:LOCALAPPDATA "PustakaJasa-AI-Helper"
$helper = Join-Path $dest "ai-file-helper.mjs"
$log = Join-Path $dest "helper.log"
$startup = [Environment]::GetFolderPath("Startup")
$vbs = Join-Path $startup "pustakajasa-ai-helper.vbs"

# Stop any running copy (this helper, or the old watch_ai_file_jobs.js
# watcher it replaces) so the new version can take the port.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'ai-file-helper\.mjs|watch_ai_file_jobs\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $startup "ai-file-watcher.vbs") -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "ai-file-helper.mjs") $helper

# A hidden VBScript wrapper runs it at login without a console window.
$vbsContent = @"
Set s = CreateObject("WScript.Shell")
s.Run "cmd /c """"$($node.Source)"" ""$helper"" >> ""$log"" 2>&1""", 0, False
"@
Set-Content -Path $vbs -Value $vbsContent -Encoding Unicode
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`""

Write-Host "Starting the AI File helper..."
$status = $null
for ($i = 0; $i -lt 10 -and -not $status; $i++) {
    Start-Sleep -Seconds 2
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:47821/status" -Headers @{ Origin = "https://pustaka-jasa.vercel.app" } -TimeoutSec 15
    } catch { }
}

Write-Host ""
if (-not $status) {
    Write-Host "FAILED: the helper did not start. Send this log to Sean: $log"
    exit 1
}
Write-Host "Installed. It starts automatically every time you log in."
if ($status.nasOk) {
    Write-Host "AI FILE folder found: YES  ($($status.aiFileDir))"
} else {
    Write-Host "AI FILE folder found: NO   ($($status.aiFileDir))"
    Write-Host "Connect this computer to the NAS, or put the correct path (one line) in:"
    Write-Host "  $(Join-Path $dest 'ai-file-dir.txt')"
}
