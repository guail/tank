!define TANK_CLI_BIN_DIR "$LOCALAPPDATA\TankHeroNotes\bin"
!define TANK_CLI_SHIM "${TANK_CLI_BIN_DIR}\tank.cmd"
!define TANK_LEGACY_CLI_SHIM "${TANK_CLI_BIN_DIR}\tank-cli.cmd"

!macro TANK_BROADCAST_ENVIRONMENT_CHANGE
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 0, i 5000, *i .r0)'
!macroend

!macro TANK_ADD_CLI_TO_USER_PATH
  ; Preserve existing user PATH entries and append only the TankHeroNotes CLI directory.
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 0
  StrCpy $2 1
  ; WordFind indexes PATH entries from 1. A trailing delimiter makes a PATH
  ; containing a single entry participate in the same merge logic.
  StrCpy $4 "$0;"

  ${Do}
    ClearErrors
    ${WordFind} "$4" ";" "E+$2" $3
    ${If} ${Errors}
      ${ExitDo}
    ${EndIf}
    ${If} $3 == "${TANK_CLI_BIN_DIR}"
      StrCpy $1 1
      ${ExitDo}
    ${EndIf}
    IntOp $2 $2 + 1
  ${Loop}

  ${If} $1 == 0
    ${If} $0 == ""
      StrCpy $0 "${TANK_CLI_BIN_DIR}"
    ${Else}
      StrCpy $0 "$0;${TANK_CLI_BIN_DIR}"
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "Path" "$0"
    !insertmacro TANK_BROADCAST_ENVIRONMENT_CHANGE
  ${EndIf}
!macroend

!macro TANK_REMOVE_CLI_FROM_USER_PATH
  ReadRegStr $0 HKCU "Environment" "Path"
  ${If} $0 != ""
    StrCpy $1 ""
    StrCpy $2 1
    ; Preserve every unrelated PATH entry, including the single-entry case.
    StrCpy $4 "$0;"

    ${Do}
      ClearErrors
      ${WordFind} "$4" ";" "E+$2" $3
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
      ${If} $3 != "${TANK_CLI_BIN_DIR}"
      ${AndIf} $3 != ""
        ${If} $1 == ""
          StrCpy $1 "$3"
        ${Else}
          StrCpy $1 "$1;$3"
        ${EndIf}
      ${EndIf}
      IntOp $2 $2 + 1
    ${Loop}

    ${If} $1 != $0
      WriteRegExpandStr HKCU "Environment" "Path" "$1"
      !insertmacro TANK_BROADCAST_ENVIRONMENT_CHANGE
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "${TANK_CLI_BIN_DIR}"
  Delete "${TANK_LEGACY_CLI_SHIM}"
  FileOpen $0 "${TANK_CLI_SHIM}" w
  ${If} $0 != ""
    FileWrite $0 "@echo off$\r$\n"
    FileWrite $0 "$\"$INSTDIR\tank-cli.exe$\" %*$\r$\n"
    FileClose $0
  ${EndIf}
  !insertmacro TANK_ADD_CLI_TO_USER_PATH
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "${TANK_CLI_SHIM}"
  Delete "${TANK_LEGACY_CLI_SHIM}"
  RMDir "${TANK_CLI_BIN_DIR}"
  !insertmacro TANK_REMOVE_CLI_FROM_USER_PATH
!macroend
