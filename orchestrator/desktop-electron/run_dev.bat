@echo off
cd /d "%~dp0"
set "BACKEND_URL=http://192.168.1.157:7812"
set "VITE_BACKEND_URL=%BACKEND_URL%"
rem 1С: SQL на сервере gateway — VPN на ПК не нужен при BACKEND_URL=192.168.1.157:7812.
rem Если erp_reachable=true, но задач 0 — админ: orchestrator\backend\docs\DEPLOY_CONSTRUCTOR_GATEWAY.md
rem Dev с локальным backend: set BACKEND_URL=http://127.0.0.1:7812 + orchestrator\backend\run_dev.bat (VPN до erp_pm на ПК).
rem Admin panel: gateway needs /api/v1/admin/* (backend commit 6d0e958+); 404 = redeploy, not frontend bug.
rem Docker often binds 5174 locally — use a free Vite port for Orchestrator.
if not defined ORCH_VITE_PORT set "ORCH_VITE_PORT=5176"
rem Sidecar: orchestrator/desktop (reset_run_scratch), not Consturctor/desktop.
set "CONSTRUCTOR_DESKTOP_ROOT=%~dp0..\..\desktop"
title Orchestrator
echo Starting Orchestrator Electron...
echo Backend: %BACKEND_URL%
echo Desktop: %CONSTRUCTOR_DESKTOP_ROOT%
echo Vite:    %ORCH_VITE_PORT%
npm run dev
if errorlevel 1 pause
