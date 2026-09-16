@echo off
cd /d "%~dp0"
if not defined BACKEND_URL set "BACKEND_URL=http://127.0.0.1:7812"
if not defined VITE_BACKEND_URL set "VITE_BACKEND_URL=%BACKEND_URL%"
if not defined ORCH_VITE_PORT set "ORCH_VITE_PORT=5176"
if not defined ORCH_PREFER_LOCAL set "ORCH_PREFER_LOCAL=1"
rem Sidecar: orchestrator/desktop (reset_run_scratch), not Consturctor/desktop.
set "CONSTRUCTOR_DESKTOP_ROOT=%~dp0..\..\desktop"
set "ORCH_BACKEND_ROOT=%~dp0..\..\backend"
title Orchestrator
echo Starting Orchestrator Electron...
echo Backend: %BACKEND_URL%
echo Desktop: %CONSTRUCTOR_DESKTOP_ROOT%
echo Vite:    %ORCH_VITE_PORT%

powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7812/health -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if errorlevel 1 (
  echo Local backend :7812 is down — starting orchestrator\backend...
  start "Orchestrator backend" /D "%ORCH_BACKEND_ROOT%" cmd /c run_dev.bat
)

npm run dev
if errorlevel 1 pause
