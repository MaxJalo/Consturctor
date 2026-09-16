@echo off
cd /d "%~dp0"
rem Respect desktop-electron\.env: ORCH_PREFER_LOCAL=1 → local backend + admin API on one host.
set "BACKEND_URL="
set "ORCH_PREFER_LOCAL="
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /I "BACKEND_URL= ORCH_PREFER_LOCAL=" ".env"`) do (
    if /I "%%A"=="BACKEND_URL" set "BACKEND_URL=%%B"
    if /I "%%A"=="ORCH_PREFER_LOCAL" set "ORCH_PREFER_LOCAL=%%B"
  )
)
if /I "%ORCH_PREFER_LOCAL%"=="1" set "BACKEND_URL=http://127.0.0.1:7812"
if not defined BACKEND_URL set "BACKEND_URL=http://192.168.1.157:7812"
set "VITE_BACKEND_URL=%BACKEND_URL%"
set "VITE_ORCH_PREFER_LOCAL=%ORCH_PREFER_LOCAL%"
rem 1С: SQL на сервере gateway — VPN на ПК не нужен при BACKEND_URL=192.168.1.157:7812.
rem OData задачи: backend\.env или agent-pochta\.env (ORCH_ODATA_ENV_PATH); «Сегодня» → onec.erp_tasks_odata.
if not defined ORCH_VITE_PORT set "ORCH_VITE_PORT=5176"
rem Sidecar: orchestrator/desktop (reset_run_scratch), not Consturctor/desktop.
for %%I in ("%~dp0..\..\desktop") do set "CONSTRUCTOR_DESKTOP_ROOT=%%~fI"
set "BACKEND_ROOT=%~dp0..\..\backend"

if /I "%BACKEND_URL%"=="http://127.0.0.1:7812" (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7812/health -TimeoutSec 3; if($r.StatusCode -eq 200){ exit 0 } } catch {}; exit 1"
  if errorlevel 1 (
    echo Local backend not running — starting orchestrator\backend ...
    if exist "%BACKEND_ROOT%\run_dev.bat" (
      start "Orchestrator Backend" /MIN cmd /c ""%BACKEND_ROOT%\run_dev.bat""
      powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(25); while((Get-Date) -lt $deadline){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7812/health -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; Start-Sleep -Milliseconds 400 }; exit 1"
      if errorlevel 1 echo WARNING: backend did not respond on :7812 in time — Electron will retry on launch.
    ) else (
      echo WARNING: backend folder not found: %BACKEND_ROOT%
    )
  )
)

title Orchestrator
echo Starting Orchestrator Electron...
echo Backend: %BACKEND_URL%
echo Desktop: %CONSTRUCTOR_DESKTOP_ROOT%
echo Vite:    %ORCH_VITE_PORT%
npm run dev
if errorlevel 1 pause
