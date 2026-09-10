@echo off
cd /d "%~dp0"
node "%~dp0start-apex.cjs"
if errorlevel 1 pause
