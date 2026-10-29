; Тихое обновление иначе сдаётся через пару секунд, пока процесс ещё жив, и установка обрывается.
!macro customCheckAppRunning
  StrCpy $R1 0
  orchKillApp:
    IntOp $R1 $R1 + 1
    nsExec::Exec `"$CmdPath" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Sleep 2000
    nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $0
    ${if} $0 == 0
      ${if} $R1 < 8
        Goto orchKillApp
      ${else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDOK
        Quit
      ${endIf}
    ${endIf}
!macroend

!macro customInstall
  StrCpy $1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$1" runps 0
  StrCpy $1 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  runps:
  nsExec::ExecToLog '"$1" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\lan-route.ps1"'
  Pop $0
  nsExec::ExecToLog 'schtasks /Create /F /TN "OrchestratorLanRoute" /SC ONLOGON /RL HIGHEST /TR "\"$1\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"$INSTDIR\resources\lan-route.ps1\""'
  Pop $0
!macroend
