@echo off
rem Double-click to install the AI File helper on this Windows computer.
rem Bypass here so nobody has to change PowerShell's execution policy first.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
