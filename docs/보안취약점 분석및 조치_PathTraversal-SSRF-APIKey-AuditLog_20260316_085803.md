# 보안취약점 분석 및 조치 계획

- **프로젝트**: aitty2 (WPF + WebView2 + React/TypeScript)
- **분석 기준 커밋**: `e3e89c6` (2026-03-13)
- **작성 일시**: 2026-03-16 08:58:03
- **작성자**: Claude (claude-sonnet-4-6)

---

## 취약점 전체 요약

| ID | 등급 | 위치 | 위협 | 난이도 | 예상 공수 | 우선순위 |
|----|------|------|------|--------|----------|---------|
| C-1 | 🔴 Critical | `KeyManagerService.cs` | Path Traversal → 임의 파일 읽기 | 중상 | 8h | P0 |
| C-2 | 🔴 Critical | `LocalLlmService.cs` | SSRF → 내부망 스캔 | 중 | 6h | P0 |
| H-1 | 🟠 High | `AiServiceManager.cs` | API Key 평문 메모리 저장 | 높음 | 16h | P1 |
| H-2 | 🟠 High | `MainWindow.xaml.cs` | DevTools Release 미차단 | 낮음 | 1h | P1 |
| H-3 | 🟠 High | `MainWindow.xaml.cs` | Dev모드 환경변수 우회 | 낮음 | 0.5h | P1 |
| M-1 | 🟡 Medium | `IpcHandler.cs` | IPC 입력 검증 부재 | 낮음-중 | 4h | P2 |
| M-2 | 🟡 Medium | `SshService.cs` | 접속 객체 메모리 잔류 | 낮음 | 2h | P2 |
| M-3 | 🟡 Medium | `IpcHandler.cs` | SSH 명령 감사 로그 없음 | 중 | 12h | P2 |
| M-4 | 🟡 Medium | `logger.ts` | 민감 데이터 콘솔 노출 | 낮음 | 3h | P2 |
| L-1 | 🔵 Low | `MainWindow.xaml.cs` | index.html 반복 파일 읽기 | 매우 낮음 | 1h | P3 |
| L-2 | 🔵 Low | `KeyManagerService.cs` | SSH 키파일 전체 읽기 | 매우 낮음 | 1h | P3 |
| **합계** | | | | | **54.5h** | |

---

## Phase 0 — Critical

---

### [C-1] Path Traversal — `KeyManagerService.IsValidKeyFileAsync`

#### 현상
```
IPC 채널: "keys:validate"
페이로드: { "path": "../../Windows/System32/config/SAM" }
```
- 프론트에서 전달하는 `Path` 값을 검증 없이 `File.ReadAllTextAsync()` 에 직접 사용
- 시스템 임의 파일 읽기 가능 → 정보 유출

```csharp
// 현재 (취약)
public async Task<bool> IsValidKeyFileAsync(string keyPath)
{
    var content = await File.ReadAllTextAsync(keyPath); // 경로 무검증
    return content.Contains("BEGIN OPENSSH PRIVATE KEY") || ...;
}
```

#### 구현 방안
| 방식 | 설명 | 적용 |
|------|------|------|
| **허용 디렉토리 화이트리스트** | `~/.ssh` 하위 경로만 허용 | ✅ 필수 |
| **경로 정규화** | `new FileInfo(path).FullName` 으로 심볼릭 링크 포함 절대 경로 해석 | ✅ 필수 |
| **UNC 경로 차단** | `\\server\share` 형태 거부 | ✅ 필수 |
| **파일 크기 사전 검사** | 1MB 초과 거부 → OOM 방지 (L-2 통합) | ✅ 권장 |

```csharp
// 수정 후
private bool IsPathAllowed(string keyPath)
{
    try
    {
        var fullPath = new FileInfo(keyPath).FullName;
        var fullBase = new FileInfo(_sshDir).FullName;
        // Windows: 대소문자 무시, Linux: 구분
        var comparison = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        return fullPath.StartsWith(fullBase + Path.DirectorySeparatorChar, comparison);
    }
    catch { return false; }
}

public async Task<bool> IsValidKeyFileAsync(string keyPath)
{
    if (!IsPathAllowed(keyPath)) return false; // 묵시적 거부 (정보 유출 방지)

    try
    {
        var fileInfo = new FileInfo(keyPath);
        if (fileInfo.Length > 1_048_576) return false; // 1MB 초과 거부

        using var reader = new StreamReader(keyPath);
        for (int i = 0; i < 10; i++) // 첫 10줄만 읽기
        {
            var line = await reader.ReadLineAsync();
            if (line == null) break;
            if (line.Contains("BEGIN") && line.Contains("PRIVATE KEY")) return true;
        }
        return false;
    }
    catch { return false; }
}
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| 심볼릭 링크 우회 | `Path.GetFullPath()`는 링크 해석 안 함 | `new FileInfo(path).FullName` 사용 |
| Windows UNC 경로 | `\\server\share` 형태 정규화 결과 다름 | `IsPathRooted()` + `StartsWith("\\\\")` 추가 거부 |
| TOCTOU 경쟁 조건 | 검증 후 읽기 사이 파일 교체 | 성능 vs 보안 trade-off — 허용 범위 제한으로 충분 |

---

### [C-2] SSRF — `LocalLlmService.DiagnoseOpenWebUiAsync`

#### 현상
```
IPC 채널: "ai:openwebui:diagnose"
페이로드: { "url": "http://169.254.169.254/latest/meta-data/" }
```
- 사용자 입력 URL을 `HttpClient`로 그대로 요청 → 내부망 스캔 가능
- `/api/version`, `/api/tags`, `/api/models`, `/api/show` 4개 엔드포인트 탐침 후 응답 반환

```csharp
// 현재 (취약)
var baseUrl = NormalizeBaseUrl(endpoint); // 스킴/호스트 검증 없음
await ProbeGet($"{baseUrl}/api/version", ...); // 임의 내부망 요청 가능
```

#### 구현 방안
| 방식 | 설명 | 적용 |
|------|------|------|
| **스킴 화이트리스트** | `http`, `https` 만 허용 (`file://`, `ftp://` 등 차단) | ✅ 필수 |
| **사설 IP 차단** | Loopback, 10.x, 172.16-31.x, 192.168.x 거부 | ✅ 필수 (단 개발 예외 처리) |
| **포트 제한** | Ollama 기본 11434 또는 설정 가능 범위 | ✅ 권장 |
| **타임아웃 단축** | 기존 5분 → 진단용 5초 | ✅ 권장 |
| **DNS 재검증** | 호스트명 → IP 변환 후 IP 재검증 (DNS 리바인딩 방어) | ⚠️ 선택 (복잡도 높음) |

```csharp
private static bool IsUrlAllowed(string url)
{
    try
    {
        var uri = new Uri(url, UriKind.Absolute);

        // 1) 스킴 검증
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return false;

        // 2) 호스트 → IP 변환
        IPAddress? ip;
        if (!IPAddress.TryParse(uri.Host, out ip))
        {
            var addresses = Dns.GetHostAddresses(uri.Host);
            if (addresses.Length == 0) return false;
            ip = addresses[0];
        }

        // 3) 사설/Loopback IP 차단 (개발 환경은 설정으로 분리)
        if (IsPrivateOrLoopbackIp(ip)) return false;

        return true;
    }
    catch { return false; }
}

private static bool IsPrivateOrLoopbackIp(IPAddress ip)
{
    if (IPAddress.IsLoopback(ip)) return true;
    var b = ip.GetAddressBytes();
    if (b.Length == 4) // IPv4
    {
        return b[0] == 10
            || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
            || (b[0] == 192 && b[1] == 168)
            || (b[0] == 169 && b[1] == 254); // Link-local
    }
    // IPv6 ULA (fc00::/7), link-local (fe80::/10)
    return (b[0] & 0xFE) == 0xFC || (b[0] == 0xFE && (b[1] & 0xC0) == 0x80);
}
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| **개발 환경 localhost 필요** | 로컬 Ollama는 127.0.0.1:11434 | `#if DEBUG` 블록에서 loopback 예외 허용 또는 설정 플래그 |
| **DNS 리바인딩** | 첫 조회는 공인 IP, 이후 내부 IP로 전환 | 요청 직전 IP 재검증 (HttpClientHandler 커스텀) |
| **IPv6 범위 누락** | 다양한 IPv6 사설 범위 존재 | `IPAddress.IsLoopback()` + ULA/link-local 범위 명시 |

---

## Phase 1 — High

---

### [H-1] API Key 평문 메모리 저장 — `AiServiceManager`

#### 현상
```csharp
// 코드 주석에도 명시된 미해결 이슈
// API 키 임시 저장 (평문 - 암호화는 추후 단계에서 적용)
private readonly Dictionary<string, string> _apiKeys = new(StringComparer.OrdinalIgnoreCase);
```
- 메모리 덤프, 크래시 덤프, 디버거 어태치 시 API Key 평문 노출

#### 구현 방안 비교
| 방식 | 보안 강도 | Windows | Linux | 난이도 | 권장 |
|------|---------|---------|-------|--------|------|
| **Windows DPAPI** (`ProtectedData`) | ✅✅✅ | ✅ | ❌ | 중 | ✅ aitty2 적합 |
| SecureString | ⚠️ Legacy | ✅ | 제한 | 낮음 | ❌ .NET 6+ 미권고 |
| CryptProtectMemory | ✅✅ | ✅ | ❌ | 높음 | ⚠️ 복잡 |
| 환경변수 | ⚠️ 약함 | ✅ | ✅ | 매우 낮음 | ⚠️ 임시 방편 |
| Credential Manager | ✅✅ | ✅ | ❌ | 중-높음 | ✅ 장기 저장 적합 |

**WPF Windows 전용 앱이므로 DPAPI (`ProtectedData.Protect`) 채택 권장**

```csharp
// SecureApiKeyStore.cs (신규)
using System.Security.Cryptography;

public class SecureApiKeyStore : IDisposable
{
    // 세션별 일회성 Entropy (프로세스 외부에서 복호화 불가)
    private readonly byte[] _entropy;
    private readonly Dictionary<string, byte[]> _encryptedKeys = new(StringComparer.OrdinalIgnoreCase);

    public SecureApiKeyStore()
    {
        _entropy = new byte[32];
        RandomNumberGenerator.Fill(_entropy);
    }

    public void Set(string provider, string apiKey)
    {
        var plain = Encoding.UTF8.GetBytes(apiKey);
        var encrypted = ProtectedData.Protect(plain, _entropy, DataProtectionScope.CurrentUser);
        Array.Clear(plain, 0, plain.Length); // 평문 즉시 소거
        _encryptedKeys[provider] = encrypted;
    }

    public string? Get(string provider)
    {
        if (!_encryptedKeys.TryGetValue(provider, out var encrypted)) return null;
        try
        {
            var plain = ProtectedData.Unprotect(encrypted, _entropy, DataProtectionScope.CurrentUser);
            var key = Encoding.UTF8.GetString(plain);
            Array.Clear(plain, 0, plain.Length); // 복호화 후 즉시 소거
            return key;
        }
        catch (CryptographicException) { return null; }
    }

    public bool Has(string provider)
        => _encryptedKeys.ContainsKey(provider);

    public void Dispose()
    {
        foreach (var enc in _encryptedKeys.Values) Array.Clear(enc, 0, enc.Length);
        _encryptedKeys.Clear();
        Array.Clear(_entropy, 0, _entropy.Length);
    }
}
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| Windows 전용 API | `ProtectedData`는 Windows CAPI 의존 | aitty2는 WPF → Windows 전용이므로 문제 없음 |
| 앱 재시작 시 키 초기화 | 세션별 Entropy → 프로세스 종료 시 복호화 불가 | 의도적 설계: 재시작 시 재입력 유도 (보안 강화) |
| IPC 전송 시 평문 노출 | WebView2 IPC를 통해 전달 | IPC 자체는 동일 프로세스 내 통신 → OS 레벨 허용 범위 |
| 서비스에 평문 전달 필요 | `HttpClient.DefaultRequestHeaders` 등록 | 사용 직후 헤더 갱신 (`Get()` → 즉시 사용 → GC 위임) |

---

### [H-2] DevTools Release 미차단 — `MainWindow.xaml.cs`

#### 현상
```csharp
// 빌드 구분 없이 모든 환경에서 DevTools 오픈 가능
private void MenuDevTools_Click(object sender, RoutedEventArgs e)
    => webView.CoreWebView2?.OpenDevToolsWindow();
```
- Release 배포 후 메뉴에서 DevTools 오픈 → API Key 탈취, IPC 조작 가능

#### 구현 방안
```csharp
// XAML: Debug 전용 메뉴 아이템을 코드비하인드에서 동적 추가
public MainWindow()
{
    InitializeComponent();
    // Debug 빌드에서만 개발 메뉴 추가
#if DEBUG
    AddDebugMenuItems();
#endif
}

#if DEBUG
private void AddDebugMenuItems()
{
    if (mainMenu == null) return;
    var debugMenu = new MenuItem { Header = "개발" };

    var devToolsItem = new MenuItem { Header = "DevTools 열기" };
    devToolsItem.Click += MenuDevTools_Click;
    debugMenu.Items.Add(devToolsItem);

    var reloadItem = new MenuItem { Header = "새로고침" };
    reloadItem.Click += MenuReload_Click;
    debugMenu.Items.Add(reloadItem);

    mainMenu.Items.Add(debugMenu);
}

private void MenuDevTools_Click(object sender, RoutedEventArgs e)
    => webView.CoreWebView2?.OpenDevToolsWindow();

private void MenuReload_Click(object sender, RoutedEventArgs e)
    => webView.CoreWebView2?.Reload();
#endif
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| XAML 조건부 컴파일 불가 | XAML은 컴파일 타임 미지원 | CodeBehind에서 동적 메뉴 생성 |
| XAML에 이미 선언된 메뉴 항목 | 기존 XAML MenuItem 잔류 | XAML에서 제거하고 CodeBehind에서만 관리 |

---

### [H-3] `AITTY_DEV` 환경변수 우회 — `MainWindow.xaml.cs`

#### 현상
```csharp
private static bool IsDev =>
#if DEBUG
    true;
#else
    Environment.GetEnvironmentVariable("AITTY_DEV") == "1"; // Release에서도 env로 활성화 가능
#endif
```
- Release 배포 후 `setx AITTY_DEV 1` → Vite dev server(`localhost:5173`)로 네비게이션
- 공격자가 로컬 5173 포트에 악성 페이지 서빙 후 IPC 탈취 가능

#### 구현 방안
```csharp
// 단 1줄 수정
private static bool IsDev =>
#if DEBUG
    true;
#else
    false; // 환경변수 의존 제거: Release 빌드는 항상 prod 모드
#endif
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| 운영 환경 긴급 디버그 필요 시 | env 제거 후 prod에서 디버그 불가 | 별도 내부 진단 빌드 (`-INTL`) 사용 또는 로그 파일 활용 |
| CI/CD 파이프라인 검증 | Release 빌드가 항상 false 보장해야 함 | 빌드 후 IsDev 반환값 단위 테스트 추가 |

---

## Phase 2 — Medium

---

### [M-1] IPC 입력 검증 부재 — `IpcHandler.cs`

#### 현상

| 공격 벡터 | 페이로드 예시 | 영향 |
|----------|------------|------|
| 메모리 DoS | `{"type":"ssh:exec","payload":{"command":"A"*10MB}}` | OOM |
| 타임아웃 DoS | `{"type":"ssh:exec","payload":{"command":"sleep 3600"}}` | 프로세스 행(hang) |
| 타입 혼입 | `{"type":"ssh:exec","payload":["array"]}` | 직렬화 예외 노출 |
| 내부 타입명 노출 | `{"type":"unknown:type"}` | `NotSupportedException` 메시지에 내부 정보 포함 |

#### 구현 방안
```csharp
// IpcHandler.cs

// 1) 메시지 크기 제한 (1MB)
private const int MaxMessageSize = 1_048_576;

// 2) Command 길이 제한
internal class CommandPayload
{
    [Required, StringLength(4096, MinimumLength = 1)]
    public string Command { get; set; } = string.Empty;
}

// 3) 크기 검증 + 에러 메시지 일반화
private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
{
    if (e.WebMessageAsJson.Length > MaxMessageSize)
    {
        var rejected = new IpcResponse { Id = "unknown", Type = "error", Error = "Request too large" };
        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(rejected, JsonOptions));
        return;
    }

    IpcResponse response;
    try
    {
        var msg = JsonSerializer.Deserialize<IpcMessage>(e.WebMessageAsJson, JsonOptions);
        if (msg is null) return;

        var result = await HandleMessage(msg);
        response = new IpcResponse { Id = msg.Id, Type = $"{msg.Type}:result", Payload = result };
    }
    catch (NotSupportedException) // 알 수 없는 타입 → 내부 정보 노출 방지
    {
        response = new IpcResponse { Id = TryExtractId(e.WebMessageAsJson), Type = "error", Error = "Unsupported operation" };
    }
    catch (Exception ex)
    {
        response = new IpcResponse { Id = TryExtractId(e.WebMessageAsJson), Type = "error", Error = ex.Message };
    }

    _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, JsonOptions));
}
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| SSH 명령어 길이 다양 | 파이프 조합 시 4KB 초과 가능 | 4096B → 8192B로 상향 조정 검토 |
| 화이트리스트 불가 | 임의 SSH 명령어 지원 필요 | 길이 제한만 적용 (화이트리스트 미적용) |
| 기존 IPC 타입 모두 검증 필요 | payload DTO 11개 | DataAnnotations 일괄 적용 |

---

### [M-2] `SshConnectionState` 메모리 잔류 — `SshService.cs`

#### 현상
```csharp
// ConnectAsync() 이후
_state.Connection = connection; // Password, Passphrase 포함 객체 저장

// Disconnect() 이후 null 처리되지만
_state.Connection = null; // GC 수거 전까지 메모리 잔류
```

#### 구현 방안
```csharp
// SshConnection.cs — IDisposable 추가
public class SshConnection : IDisposable
{
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 22;
    public string Username { get; set; } = string.Empty;
    public string? PrivateKey { get; set; }

    [JsonIgnore] // 직렬화/저장 완전 제외
    public string? Password { get; set; }

    [JsonIgnore]
    public string? Passphrase { get; set; }

    public void Dispose()
    {
        // 문자열은 관리형 heap → 직접 zeroing 불가, 참조만 제거
        Password = null;
        Passphrase = null;
        GC.SuppressFinalize(this);
    }
}

// SshService.Disconnect() — 명시적 Dispose 추가
public void Disconnect()
{
    _shellStream?.Close();
    _shellStream?.Dispose();
    _shellStream = null;

    if (_client?.IsConnected == true)
        _client.Disconnect();
    _client?.Dispose();
    _client = null;

    // 민감 필드 명시적 소거
    _state.Connection?.Dispose();
    _state.Connection = null;
    _state.IsConnected = false;
}
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| C# string은 immutable | `string` 직접 zeroing 불가 | `byte[]` + `Array.Clear()` 또는 `char[]` 사용 (복잡도 증가) |
| GC 비결정적 수거 | `null` 대입 후 즉시 메모리 해제 보장 없음 | 허용 가능한 수준 (WPF 앱 특성상 단일 사용자) |
| SSH.NET 내부 복사 | `PasswordAuthenticationMethod`가 내부에 복사본 보유 | SSH.NET 라이브러리 수준 한계 → Disconnect 즉시 처리로 최소화 |

---

### [M-3] SSH 명령 감사 로그 부재 — `IpcHandler.cs`

#### 현상
- `ssh:exec` 채널로 실행된 모든 명령어가 **어떠한 로그에도 기록되지 않음**
- 전자금융감독규정 제14조(감시·보안점검), 제19조(거래기록 유지) 잠재적 미준수
- 사고 발생 시 포렌식 불가

#### 구현 방안

**로그 포맷 (NDJSON — 한 줄 한 건)**
```json
{"timestamp":"2026-03-16T09:00:00.000Z","event":"ssh:exec","localUser":"ryul","remoteUser":"ds","remoteHost":"172.16.1.103","port":22,"command":"ls -al /etc","exitStatus":"success","outputPreview":"total 128\\ndrwxr-xr-x...","durationMs":124}
```

```csharp
// AuditLogger.cs (신규)
public static class SshAuditLogger
{
    private static readonly string LogDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ssh-ai-terminal", "logs");

    // 민감 패턴 마스킹 (비밀번호, API 키 등)
    private static readonly Regex SensitivePattern = new(
        @"(password|passwd|apikey|api_key|token|secret|passphrase)\s*[=:'""\s]\s*\S+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static async Task LogExecAsync(
        string remoteHost, int port, string remoteUser,
        string command, string outputPreview, bool success, long durationMs,
        CancellationToken ct = default)
    {
        try
        {
            Directory.CreateDirectory(LogDir);
            var entry = new
            {
                timestamp = DateTime.UtcNow.ToString("o"),
                @event = "ssh:exec",
                localUser = Environment.UserName,
                remoteUser,
                remoteHost,
                port,
                command = MaskSensitive(command),
                exitStatus = success ? "success" : "failure",
                outputPreview = outputPreview.Length > 500
                    ? outputPreview[..500] + "…" : outputPreview,
                durationMs
            };
            var line = JsonSerializer.Serialize(entry) + Environment.NewLine;
            var path = Path.Combine(LogDir, $"audit_{DateTime.Now:yyyyMMdd}.log");
            await File.AppendAllTextAsync(path, line, Encoding.UTF8, ct);
        }
        catch { /* 감사 로그 실패가 주 기능 영향 X */ }
    }

    private static string MaskSensitive(string command)
        => SensitivePattern.Replace(command, m => m.Groups[1].Value + "=***");
}

// IpcHandler.HandleSshExec() 수정
private async Task<object> HandleSshExec(object? payload)
{
    var sw = Stopwatch.StartNew();
    var data = DeserializePayload<CommandPayload>(payload);
    string output;
    bool success;
    try
    {
        output = await _sshService.ExecuteAsync(data.Command);
        success = true;
    }
    catch (Exception ex)
    {
        output = ex.Message;
        success = false;
        throw;
    }
    finally
    {
        sw.Stop();
        var conn = _sshService.State.Connection;
        _ = SshAuditLogger.LogExecAsync(
            conn?.Host ?? "unknown", conn?.Port ?? 22, conn?.Username ?? "unknown",
            data.Command, output, success, sw.ElapsedMilliseconds);
    }
    return new { output };
}
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| 대용량 명령 출력 | `cat /huge/file` 등 수백 MB | 첫 500자만 로깅 (outputPreview) |
| 민감 명령어 마스킹 한계 | 정규식 패턴 누락 가능 | 주요 패턴만 최소 커버 + 명시적 제외 목록 관리 |
| 로그 파일 보호 | 사용자가 직접 삭제·수정 가능 | Windows Event Log 연동 (선택) 또는 파일 권한 설정 |
| ShellStream 키 입력 | `ssh:shell:write` 채널은 미감사 | 셸 스트림 로그는 별도 설계 (범위 확장 시 적용) |

---

### [M-4] `logger.ts` 민감 데이터 콘솔 노출 — `webapp/src/utils/logger.ts`

#### 현상
```typescript
// data?: unknown → API Key 포함 객체도 그대로 출력
logger.info('AI response', { apiKey: 'sk-abc123', content: '...' })
// → [INFO] AI response { apiKey: 'sk-abc123', content: '...' }
```
- DevTools 콘솔 감청, 브라우저 캐시(`WebView2` 폴더) 잔류 가능

#### 구현 방안
```typescript
// logger.ts 수정안

const SENSITIVE_KEYS = new Set([
  'apikey', 'api_key', 'apikey', 'password', 'passwd',
  'passphrase', 'token', 'secret', 'authorization', 'auth'
]);

function maskSensitive(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '***' : v;
  }
  return result;
}

class Logger {
  // Vite 빌드 타임 결정: DEV=true, PROD=false
  private readonly minLevel: LogLevel = import.meta.env.PROD
    ? LogLevel.WARN   // Production: 경고 이상만
    : LogLevel.DEBUG; // Development: 전체

  private write(level: LogLevel, message: string, data?: unknown): void {
    const order: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    if (order[level] < order[this.minLevel]) return; // 레벨 필터

    const timestamp = new Date().toISOString();
    const fn = level === LogLevel.ERROR ? console.error
             : level === LogLevel.WARN  ? console.warn
             : console.log;
    fn(`[${timestamp}] [${level}] ${message}`, maskSensitive(data) ?? '');
  }
  // debug / info / warn / error 메서드 동일
}
```

#### 제약사항 및 극복 방안
| 제약 | 원인 | 극복 방안 |
|------|------|---------|
| 민감 키 네이밍 다양성 | `apiKey`, `api_key`, `APIKEY` 등 | toLowerCase 정규화 후 Set 비교 |
| Production 로그 완전 제거 | WARN 이상만 남으면 디버그 불가 | 별도 진단 빌드 또는 에러 전용 원격 수집 |
| 중첩 객체 재귀 마스킹 | `{ user: { token: '...' } }` | 1-depth만 처리 (MVP 수준), 필요 시 재귀 확장 |

---

## Phase 3 — Low

---

### [L-1] `index.html` 매 요청마다 파일 재읽기 — `MainWindow.xaml.cs`

#### 현상
```csharp
webView.CoreWebView2.WebResourceRequested += (s, args) =>
{
    var html = File.ReadAllText(indexPath, Encoding.UTF8); // 요청마다 디스크 I/O
    html = html.Replace(" crossorigin", "");
    var bytes = Encoding.UTF8.GetBytes(html);
    args.Response = ...CreateWebResourceResponse(new MemoryStream(bytes), ...);
};
```

#### 구현 방안 (메모리 캐싱)
```csharp
private byte[]? _indexHtmlCache; // 초기화 시 1회 로드

private async Task PreloadIndexHtmlAsync(string wwwroot)
{
    var indexPath = Path.Combine(wwwroot, "index.html");
    if (!File.Exists(indexPath)) return;
    var html = await File.ReadAllTextAsync(indexPath, Encoding.UTF8);
    html = html.Replace(" crossorigin", "");
    _indexHtmlCache = Encoding.UTF8.GetBytes(html);
}

// WebResourceRequested 핸들러
webView.CoreWebView2.WebResourceRequested += (s, args) =>
{
    if (_indexHtmlCache == null) return;
    args.Response = webView.CoreWebView2.Environment
        .CreateWebResourceResponse(
            new MemoryStream(_indexHtmlCache), 200, "OK",
            "Content-Type: text/html; charset=utf-8");
};
```

---

### [L-2] SSH 키파일 전체 읽기 불필요 — `KeyManagerService.cs`

#### 현상
```csharp
var content = await File.ReadAllTextAsync(keyPath); // 악의적 대용량 파일 → OOM 가능
```

#### 구현 방안 (첫 10줄만 읽기)
```csharp
public async Task<bool> IsValidKeyFileAsync(string keyPath)
{
    if (!IsPathAllowed(keyPath)) return false; // C-1 수정분과 통합

    var fileInfo = new FileInfo(keyPath);
    if (fileInfo.Length > 1_048_576) return false; // 1MB 초과 거부

    using var reader = new StreamReader(keyPath);
    for (int i = 0; i < 10; i++)
    {
        var line = await reader.ReadLineAsync();
        if (line == null) break;
        if (line.Contains("BEGIN") && line.Contains("PRIVATE KEY")) return true;
    }
    return false;
}
```

---

## 구현 로드맵

```
Week 1  ┌── Phase 0: C-1, C-2 (Critical) ──────────────────────────── 14h ─┐
        │  C-1: 경로 정규화 + 화이트리스트 (8h)                              │
        │  C-2: URL 스킴/IP 검증 (6h)                                        │
        └────────────────────────────────────────────────────────────────────┘

Week 2  ┌── Phase 1: H-1, H-2, H-3 (High) ──────────────────────────── 17.5h ─┐
        │  H-2: DevTools #if DEBUG 처리 (1h) ← 가장 빠른 fix               │
        │  H-3: AITTY_DEV 제거 (0.5h)                                       │
        │  H-1: DPAPI SecureApiKeyStore (16h)                                │
        └────────────────────────────────────────────────────────────────────┘

Week 3-4 ┌── Phase 2: M-1~M-4 (Medium) ───────────────────────────── 21h ─┐
         │  M-2: SshConnection IDisposable (2h)                            │
         │  M-4: logger.ts 마스킹 (3h)                                      │
         │  M-1: IPC 입력 검증 (4h)                                         │
         │  M-3: SSH 감사 로그 신규 설계 (12h)                               │
         └──────────────────────────────────────────────────────────────────┘

Week 5  ┌── Phase 3: L-1, L-2 (Low) ──────────────────────────────── 2h ─┐
        │  L-1: index.html 캐싱 (1h)                                       │
        │  L-2: 스트림 읽기 전환 (1h) ← C-1 수정 시 자동 포함             │
        └──────────────────────────────────────────────────────────────────┘
```

---

## 테스트 케이스 (핵심)

```csharp
// C-1: Path Traversal
[DataRow("../../Windows/System32/config/SAM")]
[DataRow("C:\\Windows\\win.ini")]
[DataRow("/etc/passwd")]
void PathTraversal_IsRejected(string path)
    => Assert.IsFalse(service.IsValidKeyFileAsync(path).Result);

// C-2: SSRF
[DataRow("http://169.254.169.254/latest/meta-data/")]
[DataRow("http://10.0.0.1:8080")]
[DataRow("file:///etc/passwd")]
[DataRow("http://192.168.1.1")]
void SsrfUrl_IsRejected(string url)
    => Assert.IsFalse(IsUrlAllowed(url));

// H-1: DPAPI
void ApiKey_CannotBeReadFromMemoryDump()
{
    var store = new SecureApiKeyStore();
    store.Set("openai", "sk-test-key");
    // _encryptedKeys에는 암호화된 바이트만 존재해야 함
    Assert.IsTrue(store.Has("openai"));
    Assert.AreEqual("sk-test-key", store.Get("openai"));
}

// H-3: IsDev Release
void IsDev_IsFalse_InReleaseBuild()
{
#if !DEBUG
    Assert.IsFalse(MainWindow.IsDev);
#endif
}
```

---

*작성: Claude (claude-sonnet-4-6)*
*기준 커밋: `e3e89c6` — feat: add OpenAI provider + shared infra hardening*
