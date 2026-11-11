@echo off
cd /d "%~dp0"
if exist "%~dp0..\ai\.venv\Scripts\python.exe" set "PYTHON=%~dp0..\ai\.venv\Scripts\python.exe"
node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)
node server.js
pause
