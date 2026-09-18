@echo off
setlocal
cd /d "%~dp0"
rem ============================================================
rem  MiniMax H3 Agent - Stop the service (Windows)
rem
rem  Normally you just press Ctrl+C in the launcher window.
rem  Use this when the launcher window was force-closed: it reads
rem  the recorded ports and kills whatever is holding them.
rem
rem  ASCII-only on purpose (see the note in the launcher).
rem ============================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] Node.js not found.
  echo.
  pause
  exit /b 1
)

node "scripts\start.mjs" --stop

echo.
pause
endlocal
