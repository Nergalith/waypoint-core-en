' Waypoint Core - Double-click start launcher
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = root & "\scripts\run_waypoint.ps1"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """"

' Keep the launcher window visible so setup/startup errors are readable.
shell.Run command, 1, False
