@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend-fastapi\configure-firebase.ps1"
echo.
pause
