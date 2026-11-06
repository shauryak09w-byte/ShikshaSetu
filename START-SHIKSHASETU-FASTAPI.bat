@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend-fastapi\run-fastapi.ps1"
if errorlevel 1 pause
