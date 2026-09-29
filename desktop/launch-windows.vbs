Option Explicit
Dim shell, files, base, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
base = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\ProactiveAgent"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & base & "\launch.ps1" & Chr(34)
On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then MsgBox "Unable to start Legion: " & Err.Description, 16, "Legion"

