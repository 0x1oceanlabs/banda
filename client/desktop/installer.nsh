; Banda's own parts of electron-builder's NSIS installer and uninstaller
; (ADR 0090, decision 8): electron-builder.config.mjs names this file as
; nsis.include.

; Banda's card (platform/updates/setup): a double-click on the installer
; shows it, and none of NSIS's own windows. The card is banda-setup.exe,
; started from the plugins folder with the installer's process, the
; folders it fills and what the app takes unpacked, so it measures how
; far the copying is itself. Once its window, of class
; BandaSetup-<installer pid>, is up, the installer goes on silent: the
; card says the step and asks the questions, by the two messages
; src/window.rs names. A card that does not come up leaves NSIS's own
; windows as they were, and a silent run shows nothing. An update runs
; the installer as a double-click does (platform/updates/desktop), so
; the card shows then too, and asks nothing.
!define BANDA_SET 0x8001
!define BANDA_ANSWER 0x8002
!ifndef BUILD_UNINSTALLER
  Var bandaCard
!endif

!macro bandaCardStart
  InitPluginsDir
  File /oname=$PLUGINSDIR\banda-setup.exe "${PROJECT_DIR}\..\..\target\release\banda-setup.exe"
  ; Each app's icon is named for its folder; Banda Local has Dev's.
  !if /FileExists "${PROJECT_DIR}\icons\${APP_FILENAME}.svg"
    File /oname=$PLUGINSDIR\banda-icon.svg "${PROJECT_DIR}\icons\${APP_FILENAME}.svg"
  !else
    File /oname=$PLUGINSDIR\banda-icon.svg "${PROJECT_DIR}\icons\banda-dev.svg"
  !endif
  !ifdef APP_64_UNPACKED_SIZE
    StrCpy $1 ${APP_64_UNPACKED_SIZE}
  !else
    StrCpy $1 0
  !endif
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  Exec `"$PLUGINSDIR\banda-setup.exe" --pid $0 --name "${PRODUCT_NAME}" --version "${VERSION}" --icon "$PLUGINSDIR\banda-icon.svg" --size $1 --extract "$PLUGINSDIR\7z-out" --dir "$INSTDIR"`
  StrCpy $2 0
  ${Do}
    FindWindow $bandaCard "BandaSetup-$0"
    ${If} $bandaCard != 0
      ${Break}
    ${EndIf}
    IntOp $2 $2 + 1
    Sleep 50
  ${LoopUntil} $2 >= 100
  ${If} $bandaCard == 0
    StrCpy $bandaCard ""
  ${Else}
    SetSilent silent
  ${EndIf}
!macroend

; The card shows step `step`: 1 installing, 5 closing Banda, 6 opening it.
!macro bandaStep step
  !ifndef BUILD_UNINSTALLER
    ${If} $bandaCard != ""
      SendMessage $bandaCard ${BANDA_SET} ${step} 0
    ${EndIf}
  !endif
!macroend

; A question, on the card (`step`, with `value`) or, with none, in
; NSIS's box (`flags`, `text`, answered `default` when silent). $R3 is 1
; to go on, 2 to stop. A card that goes away answers stop.
!macro bandaAsk step value flags text default
  !ifndef BUILD_UNINSTALLER
    ${If} $bandaCard != ""
      SendMessage $bandaCard ${BANDA_SET} ${step} ${value}
      StrCpy $R3 0
      ${Do}
        Sleep 100
        System::Call 'user32::IsWindow(p $bandaCard) i.R4'
        ${If} $R4 == 0
          StrCpy $R3 2
        ${Else}
          SendMessage $bandaCard ${BANDA_ANSWER} 0 0 $R3
        ${EndIf}
      ${LoopUntil} $R3 != 0
      SendMessage $bandaCard ${BANDA_SET} 1 0
    ${Else}
  !endif
      StrCpy $R3 2
      MessageBox ${flags} "${text}" /SD ${default} IDCANCEL +2
      StrCpy $R3 1
  !ifndef BUILD_UNINSTALLER
    ${EndIf}
  !endif
!macroend

; Banda runs on Windows 10 1809 (build 17763) or later: ConPTY and Claude
; Code need it (ADR 0090, decision 1). An older Windows is refused, and
; told why.
!macro customInit
  ${IfNot} ${Silent}
    !insertmacro bandaCardStart
  ${EndIf}
  ${WinVerGetBuild} $0
  ${If} $0 < 17763
    !insertmacro bandaAsk 4 $0 MB_OK|MB_ICONSTOP "${PRODUCT_NAME} needs Windows 10 version 1809 (build 17763) or later. This Windows is build $0." IDOK
    Quit
  ${EndIf}
!macroend

; Installed: the card says Banda opens, and the installer opens it, as
; it would if it were not silent. Told to (--force-run, as an update
; is), electron-builder's installer opens it itself, silent or not.
!macro customInstall
  ${If} $bandaCard != ""
    !insertmacro bandaStep 6
    ${IfNot} ${isForceRun}
      ${If} ${isUpdated}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      ${Else}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
      ${EndIf}
    ${EndIf}
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
      !insertmacro bandaAsk 2 0 MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" IDOK
      ${If} $R3 != 1
        Quit
      ${EndIf}
    ${EndIf}
    StrCpy $R2 1
    !insertmacro bandaStep 5
    DetailPrint "$(appClosing)"
    nsExec::Exec /TIMEOUT=60000 `"$PowerShellPath" -NoProfile -NonInteractive -Command "${BANDA_RUNNING}; foreach ($$p in @(Running)) { $$w = Get-Process -Id $$p.ProcessId -ErrorAction SilentlyContinue; if ($$w) { $$null = $$w.CloseMainWindow() } }; $$t = [Diagnostics.Stopwatch]::StartNew(); while (@(Running).Count -and $$t.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 500 }; foreach ($$p in @(Running)) { Stop-Process -Id $$p.ProcessId -Force -ErrorAction SilentlyContinue }; $$t.Restart(); while (@(Running).Count -and $$t.Elapsed.TotalSeconds -lt 5) { Start-Sleep -Milliseconds 500 }; if (@(Running).Count) { exit 10 } else { exit 11 }"`
    Pop $R0
    !insertmacro bandaStep 1
  ${ElseIf} $R0 != 11
    StrCpy $R0 11
    !insertmacro bandaLocked "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro bandaLocked "$INSTDIR\resources\banda.exe"
    !insertmacro bandaLocked "$INSTDIR\resources\node\node.exe"
  ${EndIf}
  ${If} $R0 != 11
    ; Something runs there that could not be stopped, as one started as
    ; admin: the Person closes it, or the install stops.
    !insertmacro bandaAsk 3 0 MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" IDCANCEL
    ${If} $R3 == 1
      Goto banda_check
    ${EndIf}
    Quit
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "BANDA_INSTDIR", p 0)'
!macroend
