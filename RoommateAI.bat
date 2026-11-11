@echo off
cd /d "%~dp0"
start "RoommateAI 서버" cmd /k "node backend\server.js"
timeout /t 2 /nobreak >nul
start "RoommateAI" http://127.0.0.1:3000/room-select.html
