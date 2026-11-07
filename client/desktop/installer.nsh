; Banda's own parts of electron-builder's NSIS installer and uninstaller
; (ADR 0090, decision 8): electron-builder.config.mjs names this file as
; nsis.include.

; Banda runs on Windows 10 1809 (build 17763) or later: ConPTY and Claude
; Code need it (ADR 0090, decision 1). An older Windows is refused, and
; told why.
!macro customInit
  ${WinVerGetBuild} $0
  ${If} $0 < 17763
    MessageBox MB_OK|MB_ICONSTOP "${PRODUCT_NAME} needs Windows 10 version 1809 (build 17763) or later. This Windows is build $0." /SD IDOK
    Quit
  ${EndIf}
!macroend

; Before it installs or uninstalls, Banda stops what runs from inside
; $INSTDIR\: the window and its helpers. electron-builder's own check
; matches $INSTDIR with no "\" after it, so installing Banda would stop
; Banda Dev too, from ...\banda-dev; and without PowerShell it stops every
; program named banda.exe, the engine's copies with them. This one never
; stops a program by its name.
;
; The window is asked to close, as when the Person closes it, and what
; still runs ten seconds on is stopped. The engine is still the window's
; child until ADR 0090's step 10, so it stops with the window, and its
; Agents with it.
;
; PowerShell says 10 when something runs from there, 11 when nothing does;
; anything else, it could not tell, and then the programs Windows locks
; while they run say whether one is open.

; PowerShell's list of what runs from inside $INSTDIR\. It reads the folder
; from the environment, so no quote in a user's name ends its string. It
; asks WMI, as the installer's PowerShell is 32-bit and Get-Process tells
; it no 64-bit program's path; a WMI that fails stops it.
!define BANDA_RUNNING "function Running { Get-CimInstance Win32_Process -Property ProcessId,ExecutablePath -ErrorAction Stop | ? { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$env:BANDA_INSTDIR + '\', [StringComparison]::OrdinalIgnoreCase) } }"

; $R0 is 10 when `file` is open: Windows locks a program while it runs.
!macro bandaLocked file
  ${If} ${FileExists} "${file}"
    ClearErrors
    FileOpen $R1 "${file}" a
    ${If} ${Errors}
      StrCpy $R0 10
    ${Else}
      FileClose $R1
    ${EndIf}
  ${EndIf}
!macroend

!macro customCheckAppRunning
  System::Call 'kernel32::SetEnvironmentVariable(t "BANDA_INSTDIR", t "$INSTDIR")'
  ${If} ${isUpdated}
    ; The app quit itself to update: it is given a moment to go.
    Sleep 1000
  ${EndIf}
  StrCpy $R2 0
  banda_check:
  nsExec::Exec /TIMEOUT=60000 `"$PowerShellPath" -NoProfile -NonInteractive -Command "${BANDA_RUNNING}; if (@(Running).Count) { exit 10 } else { exit 11 }"`
  Pop $R0
  ${If} $R0 == 10
    ${If} $R2 == 0
    ${AndIfNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
    ${EndIf}
    StrCpy $R2 1
    DetailPrint "$(appClosing)"
    nsExec::Exec /TIMEOUT=60000 `"$PowerShellPath" -NoProfile -NonInteractive -Command "${BANDA_RUNNING}; foreach ($$p in @(Running)) { $$w = Get-Process -Id $$p.ProcessId -ErrorAction SilentlyContinue; if ($$w) { $$null = $$w.CloseMainWindow() } }; $$t = [Diagnostics.Stopwatch]::StartNew(); while (@(Running).Count -and $$t.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 500 }; foreach ($$p in @(Running)) { Stop-Process -Id $$p.ProcessId -Force -ErrorAction SilentlyContinue }; $$t.Restart(); while (@(Running).Count -and $$t.Elapsed.TotalSeconds -lt 5) { Start-Sleep -Milliseconds 500 }; if (@(Running).Count) { exit 10 } else { exit 11 }"`
    Pop $R0
  ${ElseIf} $R0 != 11
    StrCpy $R0 11
    !insertmacro bandaLocked "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro bandaLocked "$INSTDIR\resources\banda.exe"
    !insertmacro bandaLocked "$INSTDIR\resources\node\node.exe"
  ${EndIf}
  ${If} $R0 != 11
    ; Something runs there that could not be stopped, as one started as
    ; admin: the Person closes it, or the install stops.
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY banda_check
    Quit
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "BANDA_INSTDIR", p 0)'
!macroend
