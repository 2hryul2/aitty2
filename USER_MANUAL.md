# Aitty v0.2.3 — 사용자 매뉴얼

> SSH + AI 통합 터미널 클라이언트 (Windows 전용)
> 신한DS AX본부 내부 도구

---

## 화면 구성

```
┌─────────────────────────────────────────────────────────────────────┐
│  File  Edit  View                                          [─][□][×] │
├──────────────────────────────────────────────────────────────────────┤
│                    Aitty v0.2.3 — SSH + AI Terminal                  │
│               SSH AI Terminal for Windows | 신한DS AX본부            │
├─────────────────────────────────┬──── ◀ ▶ ────────────────────────┤
│                                 │                                    │
│         SSH Terminal            │      Local LLM Terminal            │
│         (좌측 패널)              │         (우측 패널)                │
│                                 │                                    │
│  [SSH 접속 폼]                   │  [AI Provider 설정]               │
│  Host / Port / User / Password  │  Provider | Endpoint | Status | Model│
│  [Connect 버튼]                  │  [Check] [Apply] [AI분석]         │
│  ─────────────────────────      │  [System Prompt]                  │
│  ████ 터미널 출력 영역 ████      │  ────────────────────────        │
│                                 │  ████ AI 대화 터미널 ████        │
├─────────────────────────────────┴────────────────────────────────────┤
│                        © 2026 Aitty | 신한DS AX본부                  │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                    가운데 드래그로 패널 비율 조정
```

---

## 1. SSH Terminal (좌측 패널)

### 1-1. 접속

| 항목 | 설명 | 예시 |
|------|------|------|
| **Host** | 서버 IP 또는 도메인 | `172.16.1.103` |
| **Port** | SSH 포트 (기본 22) | `22` |
| **Username** | 리눅스 계정명 | `ds` |
| **Password** | 비밀번호 (선택) | `*****` |
| **Private Key** | SSH 키 파일 경로 (선택) | `~/.ssh/id_rsa` |

> **비밀번호 / Private Key** 중 하나만 입력하면 됩니다.
> Private Key 경로를 입력하면 키 기반 인증을 사용합니다.

**[Connect]** 버튼 클릭 또는 폼에서 `Enter` → 접속 시작

접속 성공 시:
```
✓ Connected to 172.16.1.103:22 as ds
[ubuntu]$
```

### 1-2. 접속 후 컨트롤

| 버튼 | 기능 |
|------|------|
| **Clear** | 터미널 화면 지우기 |
| **Disconnect** | SSH 연결 종료 |

### 1-3. 터미널 사용

- 일반 Linux 터미널과 동일하게 명령어 입력
- 스크롤백: 5,000줄 기록 유지
- 컬러 출력 지원 (ANSI 이스케이프)
- 붙여넣기: `Ctrl+Shift+V` 또는 마우스 우클릭

### 1-4. 패널 크기 조정

- 두 패널 사이의 **세로 경계선(▶)** 을 좌우로 드래그
- 최소 20% / 최대 80% 범위

---

## 2. Local LLM Terminal (우측 패널)

### 2-1. AI Provider 선택

| Provider | 특징 | 필요 설정 |
|----------|------|-----------|
| **Ollama (Local)** | 로컬 서버, 무제한 사용 | Endpoint URL |
| **Google Gemini** | 클라우드 API, 고성능 | Gemini API Key |
| **Anthropic Claude** | 클라우드 API, 고성능 추론 | Claude API Key |
| **OpenAI** | GPT 시리즈, 범용 | OpenAI API Key |

**Provider 드롭다운**에서 선택 → 입력 필드가 자동 전환

---

### 2-2. Ollama 설정

```
AI Provider: [Ollama (Local) ▼]
Engine Endpoint: [http://172.16.1.103:11434    ]
Engine Status: [Ready on http://172.16.1.103:11434]
Model: [qwen2.5-coder:7b ▼]
```

1. **Endpoint** 입력: Ollama 서버 주소 (`http://IP:11434`)
2. **[Check]** 클릭 → 연결 테스트
   - 성공: `✓ 연결되었습니다` 출력
3. **Model** 드롭다운에서 사용할 모델 선택
4. **[Apply]** 클릭 → 설정 저장 & 연결 완료

> Ollama 기본 모델 추천: `qwen2.5-coder:7b` (코딩), `llama3.1:8b` (범용)

---

### 2-3. Google Gemini 설정

```
AI Provider: [Google Gemini ▼]
Gemini API Key: [AIza...                        ]
Engine Status: [Gemini Ready]
Model: [gemini-2.0-flash ▼]
```

1. **Gemini API Key** 입력
   - 발급: [Google AI Studio](https://aistudio.google.com/app/apikey)
2. **[Check]** 클릭 → API 키 검증 & 모델 목록 로드
   - 성공: `✓ 연결되었습니다` 출력
3. **Model** 선택 (`gemini-2.0-flash` 권장)
4. **[Apply]** → 설정 완료

> **429 오류 발생 시**: 자동으로 최대 3회 재시도 (5초 → 30초 → 60초 대기)
> 무료 티어 사용 한도 초과 시 발생. 잠시 대기 후 자동 재시도됩니다.

---

### 2-4. System Prompt

AI의 역할/행동 방식을 설정합니다.

```
기본값:
"You are a local Linux SSH assistant. Analyze terminal output,
 explain issues, and suggest safe next commands.
 Prefer minimal-risk commands first."
```

자유롭게 수정 가능. **[Apply]** 로 적용.

---

### 2-5. AI 대화

설정 완료 후 터미널 하단에서 직접 입력:

```
local@aitty:~$ [질문을 입력하세요]
```

**예시:**
```
local@aitty:~$ docker ps 명령어 결과를 분석해줘

[AI 스트리밍 응답...]
현재 실행 중인 컨테이너는 3개입니다...
```

**스트리밍 중 취소**: 헤더의 **[Cancel]** 버튼 클릭

---

### 2-6. AI분석 (SSH 연동)

SSH 터미널에서 명령 실행 후 → **[AI분석]** 버튼 클릭

```
흐름:
SSH Terminal                    AI Terminal
──────────                      ──────────
$ docker logs app               ← 명령 실행
[에러 로그 출력...]
                                [AI분석] 클릭 ↓
                                SSH 마지막 출력 AI 분석 중...

                                이 에러는 메모리 부족으로 발생한...
                                권장 해결 방법: OOM 설정 조정...
```

> SSH 연결 상태에서만 **[AI분석]** 버튼이 활성화됩니다.

---

### 2-7. 터미널 내장 명령어

AI 터미널에서 직접 입력:

| 명령어 | 기능 |
|--------|------|
| `help` | 사용 가능한 명령어 목록 출력 |
| `status` | AI 엔진 연결 상태 확인 |
| `engine status` | 동일 (status 별칭) |
| `model list` | 사용 가능한 모델 목록 |
| `model use <모델명>` | 사용 모델 전환 |
| `system set <프롬프트>` | System Prompt 변경 |
| `analyze last` | SSH 마지막 출력 AI 분석 (= AI분석 버튼) |
| `clear` | 터미널 화면 지우기 |
| `reset` | 대화 이력 초기화 |

**예시:**
```
local@aitty:~$ model list
Available Models:
  qwen2.5-coder:7b  <current>
  llama3.1:8b
  gemma2:9b

local@aitty:~$ model use llama3.1:8b
Model: llama3.1:8b

local@aitty:~$ reset
Conversation history cleared.
```

---

## 3. 메뉴바

| 메뉴 | 항목 | 기능 |
|------|------|------|
| **File** | Exit | 프로그램 종료 (`Ctrl+Q`) |
| **Edit** | Undo/Redo/Cut/Copy/Paste | 텍스트 편집 기본 기능 |
| **View** | Reload | 화면 새로고침 |
| **View** | Toggle DevTools | 개발자 도구 열기 (문제 진단용) |

---

## 4. 단축키

| 단축키 | 기능 |
|--------|------|
| `Ctrl+Q` | 프로그램 종료 |
| `Ctrl+C` (AI 입력 중) | AI 응답 생성 취소 |
| `Ctrl+L` | 터미널 화면 지우기 |

---

## 5. 상태 표시

### SSH 터미널 헤더
| 표시 | 의미 |
|------|------|
| `● Connected` (녹색) | SSH 연결됨 |
| `◌ Connecting...` (황색) | 연결 중 |
| `○ Disconnected` (적색) | 미연결 |

### AI 터미널 헤더
| 표시 | 의미 |
|------|------|
| `Ready` (녹색) | AI 엔진 연결됨 |
| `Ollama Offline` (적색) | Ollama 서버 미응답 |
| `Gemini Offline` (적색) | API 키 미설정 |
| `Generating` (파랑, 점멸) | AI 응답 생성 중 |

---

## 6. 주의사항

> ⚠️ **AI 정보 신뢰도**
> AI는 정확하지 않은 정보를 제공할 수 있습니다.
> 서버 운영에 관한 중요한 명령어는 반드시 직접 확인하세요.

> ⚠️ **API 키 보안**
> Gemini API 키는 로컬에만 저장됩니다.
> 키가 타인에게 노출되지 않도록 주의하세요.

> ⚠️ **Gemini 무료 한도**
> 무료 티어는 분당 요청 횟수 제한이 있습니다.
> 429 오류 시 자동 재시도되며, 지속 시 유료 플랜 전환을 고려하세요.

---

## 7. 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| SSH 접속 실패 | 잘못된 Host/Port/Password | 접속 정보 확인 |
| AI 모델 목록 없음 | Ollama 서버 미실행 | Ollama 서버 시작 확인 |
| Gemini 429 오류 | API 사용 한도 초과 | 자동 재시도 대기 (5~60초) |
| Gemini API 오류 401 | API 키 오류 | API 키 재발급/재입력 |
| AI분석 버튼 비활성 | AI 미연결 or SSH 미연결 | Check/Apply 후 SSH 연결 |
| 화면 검은색 | 드물게 렌더링 오류 | View > Reload 또는 재시작 |

---

*Aitty v0.2.3 | 신한DS AX본부 | 2026-03-22*
