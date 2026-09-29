Option Explicit
Dim shell, files, root, node
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
node = "node"
If WScript.Arguments.Count > 0 Then node = WScript.Arguments(0)
shell.CurrentDirectory = root
shell.Run """" & node & """ """ & root & "\desktop\launch.cjs""", 0, False
