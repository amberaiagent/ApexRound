@echo off
cd /d "%~dp0"
node "%~dp0open-vps-preview.cjs"
if errorlevel 1 pause
