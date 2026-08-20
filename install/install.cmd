@echo off
setlocal
rem Windows wrapper for the patched fork runtime installer.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
