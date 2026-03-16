# Aitty2 — 마지막 작업 컨텍스트

> 업데이트: 2026-03-16 오후
> 브랜치: master

---

## 프로젝트 기본 정보

| 항목 | 내용 |
|------|------|
| **앱명** | Aitty SSH AI Terminal |
| **버전** | 0.2.0 |
| **경로** | `D:\SOURCE\aitty2` |
| **GitHub** | https://github.com/2hryul2/aitty2 |
| **스택** | WPF(.NET 8) + WebView2 + React/TypeScript(Vite) |

---

## 빌드 방법 (필수 순서)

```bash
# 1. React 빌드
cd D:\SOURCE\aitty2\webapp && npm run build

# 2. wwwroot 완전 교체 (구 hash 파일 제거 필수)
rm -rf /d/SOURCE/aitty2/src/Aitty/wwwroot/*
cp -r /d/SOURCE/aitty2/webapp/dist/. /d/SOURCE/aitty2/src/Aitty/wwwroot/

# 3. obj/bin 캐시 삭제 (glob 캐시 문제 방지)
rm -rf /d/SOURCE/aitty2/src/Aitty/obj /d/SOURCE/aitty2/src/Aitty/bin

# 4. dotnet restore
cd /d/SOURCE/aitty2 && dotnet restore src/Aitty/Aitty.csproj -r win-x64

# 5. dotnet publish
dotnet publish src/Aitty/Aitty.csproj -c Release -r win-x64 --no-restore --self-contained true -o publish
```

**출력**: `D:\SOURCE\aitty2\publish\Aitty.exe`

### 인스톨러 빌드

```bash
# ISCC.exe 실제 경로 (Program Files 아님!)
powershell -Command "& 'C:\Users\2hryu\AppData\Local\Programs\Inno Setup 6\ISCC.exe' 'D:\SOURCE\aitty2\installer\setup.iss'"
```

**출력**: `D:\SOURCE\aitty2\Aitty_Setup_v0.2.0.exe` (51MB)

---

## 최근 커밋 (HEAD)

| 커밋 | 내용 |
|------|------|
| `5a7fb37` | docs: 개발노트 V0.2.0 오후 세션 추가 |
| `5dc2bfb` | fix: ai.models/providers 예외 시 Step 미출력 버그 |
| `43bb532` | feat: 연결 실패 시 서버 진단 명령어 출력 |
| `9c1f0e0` | feat: Engine Endpoint URL localStorage 영속 저장 |
| `b398b9a` | feat: OpenAI ChatGPT 이름 + 실제 엔드포인트 표시 |
| `b645625` | feat: Ollama nginx Bearer 인증 지원 |
| `2cebf8d` | fix: SSRF 완화 (169.254.x.x만 차단) |

---

## 핵심 아키텍처

```
WPF MainWindow
  └─ WebView2 (React SPA)
       └─ IPC Bridge (window.chrome.webview)
            └─ IpcHandler.cs
                 └─ AiServiceManager.cs
                      ├─ LocalLlmService.cs    (Ollama + Bearer 인증)
                      ├─ ClaudeApiService.cs
                      ├─ GeminiService.cs
                      └─ OpenAiService.cs
```

---

## 주요 파일

| 파일 | 역할 |
|------|------|
| `webapp/src/components/AITerminal.tsx` | 메인 UI (설정 패널, 연결 트레이스, 터미널) |
| `webapp/src/bridge/ipcBridge.ts` | IPC 타입 정의 및 호출 래퍼 |
| `webapp/src/styles/terminal.css` | UI 스타일 |
| `src/Aitty/Services/LocalLlmService.cs` | Ollama 연결 (Bearer 인증, SSRF 차단) |
| `src/Aitty/Services/AiServiceManager.cs` | 멀티 프로바이더 관리 |
| `src/Aitty/Services/SecureApiKeyStore.cs` | DPAPI 기반 API Key 암호화 |
| `src/Aitty/Ipc/IpcHandler.cs` | IPC 메시지 라우팅 |
| `installer/setup.iss` | Inno Setup 인스톨러 스크립트 |

---

## 알려진 이슈 / 특이사항

| 항목 | 내용 |
|------|------|
| **DPAPI** | 앱 재시작 시 API Key 재입력 필요 (per-session Entropy — 의도적 설계) |
| **localStorage** | `aitty.endpointUrl`, `aitty.saveApiLog` 저장됨 / API Key 제외 |
| **SSRF** | 169.254.x.x만 차단, 사설IP/loopback 전부 허용 |
| **nginx proxy** | Ollama API Key 입력 시 Bearer 헤더 자동 적용 |
| **CS0067** | RelayCommand.CanExecuteChanged 미사용 경고 — Pre-existing, 무해 |
| **ISCC 경로** | `C:\Users\2hryu\AppData\Local\Programs\Inno Setup 6\ISCC.exe` |

---

## Provider 설정

| ID | 표시명 | Endpoint |
|----|--------|---------|
| `ollama` | API 접속 | 사용자 입력 (localStorage 저장) |
| `gemini` | Google Gemini | https://generativelanguage.googleapis.com |
| `claude` | Anthropic Claude | https://api.anthropic.com |
| `openai` | OpenAI ChatGPT | https://api.openai.com |
