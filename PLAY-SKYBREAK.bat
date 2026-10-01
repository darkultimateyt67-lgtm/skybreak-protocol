@echo off
title SKYBREAK PROTOCOL - game server
cd /d "%~dp0"

echo.
echo   ================================================
echo    SKYBREAK PROTOCOL
echo   ================================================
echo.

REM First run only: pull dependencies.
if not exist "node_modules" (
  echo   First run - installing dependencies, please wait...
  call npm install
  echo.
)

echo   Starting server...
echo   The game will open in your browser automatically.
echo.
echo   Leave this window OPEN while you play.
echo   Close it when you are done to stop the server.
echo.

REM Give Vite a moment to bind the port, then open the browser.
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"

call npm run dev

echo.
echo   Server stopped. Press any key to close.
pause >nul
