; =============================================================================
;  Aitty SSH Terminal - Inno Setup Script v0.2.0
;  Compile: ISCC.exe setup.iss
; =============================================================================

#define AppName      "Aitty SSH Terminal"
#define AppVersion   "0.2.0"
#define AppPublisher "Shinhan DS AX"
#define AppExeName   "Aitty.exe"
#define AppId        "{{8A3F2E1B-4C5D-4E6F-9A0B-1C2D3E4F5A6B}"
#define SourceDir    "..\publish"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/2hryul2/aitty2
AppSupportURL=https://github.com/2hryul2/aitty2/issues
AppUpdatesURL=https://github.com/2hryul2/aitty2/releases
DefaultDirName={localappdata}\Aitty
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\
OutputBaseFilename=Aitty_Setup_v{#AppVersion}
SetupIconFile=
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=120
ShowLanguageDialog=no
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} Installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
CloseApplications=yes
CloseApplicationsFilter=*Aitty*
RestartApplications=no

; 최소 OS: Windows 10 1903 (18362)
MinVersion=10.0.18362

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon";   Description: "{cm:CreateDesktopIcon}";   GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 모든 앱 파일 복사 (install.ps1, uninstall.ps1 제외 - 인스톨러가 대체)
Source: "{#SourceDir}\*";            DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "install.ps1,uninstall.ps1,README.txt"
; WebView2 Bootstrapper (setup/ 폴더에 포함된 경우)
Source: "{#SourceDir}\setup\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall skipifsourcedoesntexist; Check: WebView2SetupExists

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}";  Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; WebView2 Runtime 설치 (필요한 경우)
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Microsoft WebView2 Runtime 설치 중..."; Check: NeedWebView2; Flags: waituntilterminated

; 설치 완료 후 앱 실행 (선택)
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; 제거 전 프로세스 종료
Filename: "taskkill.exe"; Parameters: "/F /IM Aitty.exe"; Flags: runhidden; RunOnceId: "KillAitty"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// ── WebView2 Runtime 체크 ──────────────────────────────────────────────────
const
  WV2_GUID = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function GetWebView2Version: string;
var
  version: string;
begin
  Result := '';
  // Machine-wide (64-bit)
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WV2_GUID, 'pv', version) then
    if (version <> '') and (version <> '0.0.0.0') then begin Result := version; Exit; end;
  // Machine-wide (32-bit)
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WV2_GUID, 'pv', version) then
    if (version <> '') and (version <> '0.0.0.0') then begin Result := version; Exit; end;
  // Per-user
  if RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WV2_GUID, 'pv', version) then
    if (version <> '') and (version <> '0.0.0.0') then begin Result := version; Exit; end;
end;

function NeedWebView2: Boolean;
begin
  Result := GetWebView2Version = '';
end;

function WebView2SetupExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{src}\..\publish\setup\MicrosoftEdgeWebview2Setup.exe'))
            or FileExists(ExpandConstant('{src}\setup\MicrosoftEdgeWebview2Setup.exe'));
end;

// ── 설치 전 체크 ───────────────────────────────────────────────────────────
function InitializeSetup: Boolean;
var
  wv2ver: string;
  msg: string;
begin
  Result := True;

  // Windows 버전 체크 (18362 = Win10 1903)
  if not (GetWindowsVersion >= $0A002E22) then begin
    MsgBox('Windows 10 버전 1903 이상이 필요합니다.' + #13#10 + '현재 Windows를 업데이트해 주세요.', mbError, MB_OK);
    Result := False;
    Exit;
  end;

  // WebView2 체크 — 없고 bundled도 없으면 경고
  wv2ver := GetWebView2Version;
  if wv2ver = '' then begin
    if not WebView2SetupExists then begin
      msg := 'Microsoft WebView2 Runtime이 설치되어 있지 않습니다.' + #13#10 + #13#10;
      msg := msg + '설치를 계속하면 인터넷에서 WebView2를 자동으로 다운로드합니다.' + #13#10;
      msg := msg + '(오프라인 환경이라면 취소 후 수동 설치가 필요합니다)' + #13#10 + #13#10;
      msg := msg + '계속하시겠습니까?';
      if MsgBox(msg, mbConfirmation, MB_YESNO) = IDNO then begin
        Result := False;
        Exit;
      end;
    end;
  end;
end;

// ── WebView2 온라인 다운로드 (번들 없는 경우) ─────────────────────────────
procedure CurStepChanged(CurStep: TSetupStep);
var
  tmpFile: string;
  psCmd: string;
  res: Integer;
begin
  if (CurStep = ssInstall) and NeedWebView2 and not WebView2SetupExists then begin
    tmpFile := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
    WizardForm.StatusLabel.Caption := 'WebView2 Runtime 다운로드 중...';
    psCmd := '-NoProfile -Command "Invoke-WebRequest -Uri ''https://go.microsoft.com/fwlink/p/?LinkId=2124703'' -OutFile ''' + tmpFile + '''"';
    if not Exec('powershell.exe', psCmd, '', SW_HIDE, ewWaitUntilTerminated, res) or (res <> 0) then begin
      MsgBox('WebView2 Runtime 다운로드에 실패했습니다.' + #13#10 + 'https://go.microsoft.com/fwlink/p/?LinkId=2124703 에서 수동 설치해 주세요.', mbError, MB_OK);
      Exit;
    end;
    WizardForm.StatusLabel.Caption := 'WebView2 Runtime 설치 중...';
    Exec(tmpFile, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, res);
  end;
end;

// ── 설치 완료 메시지 ──────────────────────────────────────────────────────
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then begin
    WizardForm.FinishedLabel.Caption :=
      '{#AppName}' + ' v{#AppVersion}' + ' 설치가 완료되었습니다!' + #13#10 + #13#10 +
      '설치 경로: ' + ExpandConstant('{app}') + #13#10 + #13#10 +
      '아래 체크박스를 선택하여 지금 바로 실행할 수 있습니다.';
  end;
end;
