@echo off
cd /d "%~dp0"
set "LOCAL_BACKEND=http://127.0.0.1:7812"
set "LAN_BACKEND=http://192.168.1.157:7812"
set "BACKEND_URL=%LOCAL_BACKEND%"
set "ORCH_PREFER_LOCAL=1"

rem Prefer local orchestrator/backend (current erp_tasks + turboproject).
rem ORCH_PREFER_LOCAL=1: never use LAN — stale 192.168.1.157 may return 0 ERP tasks while Turbo works.
if /I "%ORCH_PREFER_LOCAL%"=="1" goto :prefer_local
goto :maybe_lan

:prefer_local
powershell -NoProfile -Command ^
  "$local='%LOCAL_BACKEND%';" ^
  "function Ok($u){ try { $r=Invoke-WebRequest -UseBasicParsing ($u.TrimEnd('/')+'/health') -TimeoutSec 4; return $r.StatusCode -eq 200 } catch { $false } };" ^
  "if(Ok $local){ exit 0 } else { exit 1 }"
if not errorlevel 1 goto :local_ok
echo Local backend down — starting orchestrator\backend ...
start "orchestrator-backend" /MIN cmd /c "cd /d %~dp0..\..\backend && run_dev.bat"
timeout /t 5 /nobreak >nul
:local_ok
set "BACKEND_URL=%LOCAL_BACKEND%"
echo Using local backend %BACKEND_URL% (ORCH_PREFER_LOCAL=1, LAN skipped)
goto :vite

:maybe_lan
powershell -NoProfile -Command ^
  "$local='%LOCAL_BACKEND%'; $lan='%LAN_BACKEND%';" ^
  "function Ok($u){ try { $r=Invoke-WebRequest -UseBasicParsing ($u.TrimEnd('/')+'/health') -TimeoutSec 4; return $r.StatusCode -eq 200 } catch { $false } };" ^
  "if(Ok $local){ exit 0 }; if(Ok $lan){ exit 1 }; exit 2"

if errorlevel 2 (
  echo Local backend down — starting orchestrator\backend ...
  start "orchestrator-backend" /MIN cmd /c "cd /d %~dp0..\..\backend && run_dev.bat"
  timeout /t 3 /nobreak >nul
  set "BACKEND_URL=%LOCAL_BACKEND%"
  goto :vite
)
if errorlevel 1 (
  echo LAN gateway is up; local :7812 is down — using %LAN_BACKEND%
  set "BACKEND_URL=%LAN_BACKEND%"
  goto :vite
)
echo Using local backend %LOCAL_BACKEND%

:vite
set "VITE_BACKEND_URL=%BACKEND_URL%"
rem Docker often binds 5174 locally — use a free Vite port for Orchestrator.
if not defined ORCH_VITE_PORT set "ORCH_VITE_PORT=5176"
rem Use orchestrator/desktop (has reset_run_scratch), not sibling Consturctor/desktop.
set "CONSTRUCTOR_DESKTOP_ROOT=%~dp0..\..\desktop"
title Orchestrator
echo Starting Orchestrator Electron...
echo Backend: %BACKEND_URL%
echo Desktop: %CONSTRUCTOR_DESKTOP_ROOT%
echo Vite:    %ORCH_VITE_PORT%
npm run dev
if errorlevel 1 pause
