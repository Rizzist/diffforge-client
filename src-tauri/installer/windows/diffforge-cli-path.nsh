!include LogicLib.nsh

!macro DIFFFORGE_WRITE_CLI_SHIM
  CreateDirectory "$INSTDIR\bin"
  FileOpen $0 "$INSTDIR\bin\diffforge.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "setlocal$\r$\n"
  FileWrite $0 "set $\"DIFFFORGE_APP_DIR=%~dp0..$\"$\r$\n"
  FileWrite $0 "if exist $\"%DIFFFORGE_APP_DIR%\rust-diffforge.exe$\" ($\r$\n"
  FileWrite $0 "  $\"%DIFFFORGE_APP_DIR%\rust-diffforge.exe$\" %*$\r$\n"
  FileWrite $0 "  exit /b %ERRORLEVEL%$\r$\n"
  FileWrite $0 ")$\r$\n"
  FileWrite $0 "if exist $\"%DIFFFORGE_APP_DIR%\Diff Forge AI.exe$\" ($\r$\n"
  FileWrite $0 "  $\"%DIFFFORGE_APP_DIR%\Diff Forge AI.exe$\" %*$\r$\n"
  FileWrite $0 "  exit /b %ERRORLEVEL%$\r$\n"
  FileWrite $0 ")$\r$\n"
  FileWrite $0 "echo Diff Forge executable was not found. Reinstall Diff Forge AI. 1>&2$\r$\n"
  FileWrite $0 "exit /b 127$\r$\n"
  FileClose $0
!macroend

!macro DIFFFORGE_WRITE_PATH_HELPER
  FileOpen $0 "$INSTDIR\bin\diffforge-cli-path.ps1" w
  FileWrite $0 "param([string]$$BinDir, [string]$$Mode = 'Install')$\r$\n"
  FileWrite $0 "$$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $0 "$$normalized = [IO.Path]::GetFullPath($$BinDir).TrimEnd('\')$\r$\n"
  FileWrite $0 "function Update-DiffForgePath([EnvironmentVariableTarget]$$Target) {$\r$\n"
  FileWrite $0 "  $$current = [Environment]::GetEnvironmentVariable('Path', $$Target)$\r$\n"
  FileWrite $0 "  $$parts = @()$\r$\n"
  FileWrite $0 "  if ($$current) { $$parts = $$current -split ';' | Where-Object { $$_.Trim() } }$\r$\n"
  FileWrite $0 "  $$next = @($$parts | Where-Object { $$_.TrimEnd('\') -ine $$normalized })$\r$\n"
  FileWrite $0 "  if ($$Mode -eq 'Install') { $$next = @($$normalized) + $$next }$\r$\n"
  FileWrite $0 "  [Environment]::SetEnvironmentVariable('Path', ($$next -join ';'), $$Target)$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileWrite $0 "try {$\r$\n"
  FileWrite $0 "  Update-DiffForgePath Machine$\r$\n"
  FileWrite $0 "} catch {$\r$\n"
  FileWrite $0 "  Update-DiffForgePath User$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileClose $0
!macroend

!macro DIFFFORGE_REFRESH_ENVIRONMENT
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro DIFFFORGE_WRITE_CLI_SHIM
  !insertmacro DIFFFORGE_WRITE_PATH_HELPER
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\bin\diffforge-cli-path.ps1" -BinDir "$INSTDIR\bin" -Mode Install'
  !insertmacro DIFFFORGE_REFRESH_ENVIRONMENT
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} ${FileExists} "$INSTDIR\bin\diffforge-cli-path.ps1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\bin\diffforge-cli-path.ps1" -BinDir "$INSTDIR\bin" -Mode Remove'
    !insertmacro DIFFFORGE_REFRESH_ENVIRONMENT
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\bin\diffforge.cmd"
  Delete "$INSTDIR\bin\diffforge-cli-path.ps1"
  RMDir "$INSTDIR\bin"
!macroend
