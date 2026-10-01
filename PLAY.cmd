@echo off
title SKYBREAK PROTOCOL
cd /d "%~dp0"

rem If the game server is already running, just open the browser.
netstat -an | findstr /c":5173 " | findstr LISTENING >nul
if %errorlevel%==0 (
  start "" http://localhost:5173
  exit /b
)

rem Otherwise start the server, then open the browser once it is up.
start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:5173"
echo Starting SKYBREAK PROTOCOL... keep this window open while playing.
call npm run dev
