# =============================================================================
#  Aitty SSH Terminal — Uninstaller v0.2.0
#  사용법: 탐색기에서 우클릭 → "PowerShell로 실행"
#         또는: powershell -ExecutionPolicy Bypass -File uninstall.ps1
#         또는: 제어판 → 앱 및 기능 → Aitty SSH Terminal → 제거
# =============================================================================

$ErrorActionPreference = "Stop"

$AppName    = "Aitty SSH Terminal"
$InstallDir = Join-Path $env:LOCALAPPDATA "Aitty"
$AppDataDir = Join-Path $env:APPDATA "ssh-ai-terminal"

function Header($msg) {
    Write-Host ""
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "  $('─' * $msg.Length)" -ForegroundColor DarkCyan
}
function OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function INFO($msg) { Write-Host "  [..] $msg" -ForegroundColor Yellow }
function SKIP($msg) { Write-Host "  [--] $msg" -ForegroundColor Gray }

# ── 배너 ───────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║    Aitty SSH Terminal — 제거              ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
Write-Host "  제거 경로: $InstallDir" -ForegroundColor Gray
Write-Host ""

$confirm = Read-Host "  Aitty SSH Terminal을 제거하시겠습니까? (Y/N)"
if ($confirm -notmatch "^[Yy]") {
    Write-Host "  취소되었습니다." -ForegroundColor Yellow
    exit 0
}

# ── 1. 실행 중인 프로세스 종료 ─────────────────────────────────────────────
Header "1/4  프로세스 종료"

$running = Get-Process -Name "Aitty" -ErrorAction SilentlyContinue
if ($running) {
    INFO "실행 중인 Aitty를 종료합니다..."
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 1500
    OK "Aitty 프로세스 종료"
}
else {
    SKIP "실행 중인 프로세스 없음"
}

# ── 2. 앱 데이터 처리 ─────────────────────────────────────────────────────
Header "2/4  앱 데이터 처리"

if (Test-Path $AppDataDir) {
    Write-Host ""
    Write-Host "  앱 데이터 디렉토리가 있습니다: $AppDataDir" -ForegroundColor White
    Write-Host "  (SSH 감사 로그, AI 대화 로그, 설정 파일)" -ForegroundColor Gray
    Write-Host ""
    $delData = Read-Host "  앱 데이터도 함께 삭제하시겠습니까? (Y/N)"
    if ($delData -match "^[Yy]") {
        Remove-Item $AppDataDir -Recurse -Force
        OK "앱 데이터 삭제 완료: $AppDataDir"
    }
    else {
        SKIP "앱 데이터 보존: $AppDataDir"
    }
}
else {
    SKIP "앱 데이터 없음"
}

# ── 3. 설치 파일 및 WebView2 캐시 제거 ────────────────────────────────────
Header "3/4  설치 파일 제거"

if (Test-Path $InstallDir) {
    # WebView2 캐시 처리
    $wv2Cache = Join-Path $InstallDir "WebView2"
    if (Test-Path $wv2Cache) {
        Write-Host ""
        Write-Host "  WebView2 캐시: $wv2Cache" -ForegroundColor White
        $delCache = Read-Host "  WebView2 캐시도 삭제하시겠습니까? (Y/N)"
        if ($delCache -match "^[Yy]") {
            Remove-Item $wv2Cache -Recurse -Force -ErrorAction SilentlyContinue
            OK "WebView2 캐시 삭제"
        }
        else {
            SKIP "WebView2 캐시 보존"
        }
    }

    # 설치 디렉토리 제거
    Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $InstallDir)) {
        OK "설치 디렉토리 제거: $InstallDir"
    }
    else {
        INFO "일부 파일이 남아 있습니다 (재부팅 후 수동 삭제): $InstallDir"
    }
}
else {
    SKIP "설치 디렉토리 없음"
}

# ── 4. 바로가기 및 레지스트리 정리 ────────────────────────────────────────
Header "4/4  바로가기 및 레지스트리 정리"

# 바탕화면 바로가기
$WshShell  = New-Object -ComObject WScript.Shell
$Desktop   = $WshShell.SpecialFolders("Desktop")
$DesktopLnk = "$Desktop\Aitty SSH Terminal.lnk"
if (Test-Path $DesktopLnk) {
    Remove-Item $DesktopLnk -Force
    OK "바탕화면 바로가기 제거"
}
else {
    SKIP "바탕화면 바로가기 없음"
}

# 시작 메뉴
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Aitty"
if (Test-Path $StartMenu) {
    Remove-Item $StartMenu -Recurse -Force
    OK "시작 메뉴 항목 제거"
}
else {
    SKIP "시작 메뉴 항목 없음"
}

# 레지스트리 (제어판 앱 목록)
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Aitty"
if (Test-Path $RegPath) {
    Remove-Item $RegPath -Recurse -Force
    OK "제어판 앱 목록 제거"
}
else {
    SKIP "레지스트리 항목 없음"
}

# ── 완료 ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║       제거가 완료되었습니다.              ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Read-Host "  Enter를 누르면 종료합니다"
