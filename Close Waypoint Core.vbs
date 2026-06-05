' Waypoint Core - Double-click stop launcher
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = root & "\scripts\close_waypoint.ps1"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """"

shell.Run command, 0, True
MsgBox "Waypoint Core has been stopped.", vbInformation, "Waypoint Core"
