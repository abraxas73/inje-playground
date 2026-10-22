#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
#ifdef UpdaterTest
AppId=InnocrewIsolatedUpdaterTest
Uninstallable=no
UsePreviousAppDir=no
#else
AppId={{CA6A3414-7E01-4B96-B198-913822B4E099}
#endif
AppName=INNOCREW
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher=INNOGRID
DefaultDirName={localappdata}\Programs\INNOGRID
DefaultGroupName=INNOGRID
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
#ifdef UpdaterTest
OutputDir={#TestOutput}
#else
OutputDir=..\build\windows\distribution
#endif
OutputBaseFilename=INNOGRID-Windows-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\INNOGRID.exe
CloseApplications=yes
[Files]
#ifdef UpdaterTest
Source: "{#TestPayload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#else
Source: "..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif
#ifndef UpdaterTest
[Icons]
Name: "{group}\INNOCREW"; Filename: "{app}\INNOGRID.exe"
[InstallDelete]
; 이름 변경(2026-10-22) 전 시작 메뉴 바로가기 정리 — 설치 폴더·exe 이름은 업데이트 호환 위해 INNOGRID 유지
Type: files; Name: "{group}\INNOGRID.lnk"
[Registry]
Root: HKCU; Subkey: "Software\Classes\innogrid"; ValueType: string; ValueData: "URL:INNOGRID Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\innogrid"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\innogrid\shell\open\command"; ValueType: string; ValueData: """{app}\INNOGRID.exe"" ""%1"""
#endif
[Run]
Filename: "{app}\INNOGRID.exe"; Description: "INNOCREW 실행"; Flags: nowait postinstall skipifsilent; Check: not IsAutomaticUpdate
Filename: "{app}\INNOGRID.exe"; Flags: nowait; Check: IsAutomaticUpdate

[Code]
function OpenProcess(dwDesiredAccess: Cardinal; bInheritHandle: Boolean; dwProcessId: Cardinal): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(hHandle: THandle; dwMilliseconds: Cardinal): Cardinal;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(hObject: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';
function GetLastError(): Cardinal;
  external 'GetLastError@kernel32.dll stdcall';

function IsAutomaticUpdate(): Boolean;
begin
  Result := ExpandConstant('{param:INNOCREWAUTOUPDATE|0}') = '1';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  OldPid: Integer;
  OldProcess: THandle;
  WaitResult, OpenError: Cardinal;
begin
  Result := '';
  if not IsAutomaticUpdate() then Exit;
  OldPid := StrToIntDef(ExpandConstant('{param:INNOCREWPID|0}'), 0);
  if OldPid <= 0 then begin
    Result := '업데이트를 시작한 앱을 확인할 수 없습니다.';
    Exit;
  end;
  // Native adapter requests WM_CLOSE only after this installer is running.
  // Wait on that exact PID; never terminate other processes or force a reboot.
  OldProcess := OpenProcess($00100000, False, OldPid); // SYNCHRONIZE
  if OldProcess = 0 then begin
    OpenError := GetLastError();
    if OpenError <> 87 then Result := '기존 앱 종료 상태를 확인하지 못했습니다.';
    Exit; // ERROR_INVALID_PARAMETER means the old process already exited.
  end;
  try
    WaitResult := WaitForSingleObject(OldProcess, 30000);
    if WaitResult <> 0 then Result := '앱이 종료되지 않아 업데이트를 취소했습니다. 앱을 종료한 뒤 다시 시도해 주세요.';
  finally
    CloseHandle(OldProcess);
  end;
end;
