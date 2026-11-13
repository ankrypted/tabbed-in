@echo off
rem Double-click to install Tabbed In. This just runs install.ps1 (open it in
rem Notepad to read exactly what it does) for this one run only; it does not
rem change your PowerShell settings.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
