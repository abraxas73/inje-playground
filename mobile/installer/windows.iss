#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
AppId={{CA6A3414-7E01-4B96-B198-913822B4E099}
AppName=INNOGRID
AppVersion={#AppVersion}
AppPublisher=INNOGRID
DefaultDirName={localappdata}\Programs\INNOGRID
DefaultGroupName=INNOGRID
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\build\windows\distribution
OutputBaseFilename=INNOGRID-Windows-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\INNOGRID.exe
CloseApplications=yes
[Files]
Source: "..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\INNOGRID"; Filename: "{app}\INNOGRID.exe"
[Registry]
Root: HKCU; Subkey: "Software\Classes\innogrid"; ValueType: string; ValueData: "URL:INNOGRID Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\innogrid"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\innogrid\shell\open\command"; ValueType: string; ValueData: """{app}\INNOGRID.exe"" ""%1"""
[Run]
Filename: "{app}\INNOGRID.exe"; Description: "INNOGRID 실행"; Flags: nowait postinstall skipifsilent
