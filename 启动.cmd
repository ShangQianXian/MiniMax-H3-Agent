@echo off
setlocal
cd /d "%~dp0"
rem ============================================================
rem  MiniMax H3 Agent - One-click start (Windows)
rem  Double-click this file to start.
rem
rem  This file is intentionally ASCII-only: cmd.exe runs on a GBK
rem  code page by default and would garble Chinese text. All the
rem  Chinese output comes from Node (node scripts/start.mjs).
rem ============================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] Node.js not found.
  echo       Please install Node.js 22 or newer: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR set "NODE_MAJOR=0"
if %NODE_MAJOR% LSS 22 (
  echo.
  echo   [x] Node.js 22 or newer is required.
  echo       Current version:
  node -v
  echo.
  pause
  exit /b 1
)

rem First run: install dependencies first, so the services the launcher
rem spawns actually have something to run.
if not exist "node_modules" (
  echo.
  echo   First run: installing dependencies, this takes 1-2 minutes...
  echo.
  where pnpm >nul 2>nul
  if errorlevel 1 (
    echo   pnpm not found, enabling it via corepack...
    call corepack enable
  )
  set "CI=true"
  call pnpm install
  if errorlevel 1 (
    echo.
    echo   [x] Dependency installation failed.
    echo       Run "pnpm install" manually to see the full error.
    echo.
    pause
    exit /b 1
  )
)

node "scripts\start.mjs" %*

if errorlevel 1 (
  echo.
  pause
)
endlocal
