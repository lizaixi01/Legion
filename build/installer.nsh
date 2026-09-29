; Custom NSIS page for the Legion installer: a checkbox for the desktop shortcut.
; (The finish page already offers "run Legion" through runAfterFinish.)
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!macro customPageAfterChangeDir
  Page custom LegionShortcutPageCreate LegionShortcutPageLeave
!macroend

; The uninstaller build also includes this file, but it never inserts the page macro.
!ifndef BUILD_UNINSTALLER
Var LegionShortcutCheckbox
Var LegionCreateShortcut
Var LegionPageDialog
Var LegionPageLabel

Function LegionShortcutPageCreate
  nsDialogs::Create 1018
  Pop $LegionPageDialog
  ${If} $LegionPageDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "选择是否在桌面创建 Legion 快捷方式："
  Pop $LegionPageLabel
  ${If} $LegionCreateShortcut == ""
    StrCpy $LegionCreateShortcut "1"
  ${EndIf}
  ${NSD_CreateCheckbox} 0 30u 100% 12u "创建桌面快捷方式"
  Pop $LegionShortcutCheckbox
  ${NSD_SetState} $LegionShortcutCheckbox $LegionCreateShortcut
  nsDialogs::Show
FunctionEnd

Function LegionShortcutPageLeave
  ${NSD_GetState} $LegionShortcutCheckbox $LegionCreateShortcut
FunctionEnd
!endif

!macro customInstall
  ; Empty means the page never ran (silent install) - keep the default of creating it.
  ${If} $LegionCreateShortcut != "0"
    CreateShortCut "$DESKTOP\Legion.lnk" "$INSTDIR\Legion.exe" "" "$INSTDIR\Legion.exe" 0 "" "" "Legion"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\Legion.lnk" "${APP_ID}"
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Legion.lnk"
!macroend
