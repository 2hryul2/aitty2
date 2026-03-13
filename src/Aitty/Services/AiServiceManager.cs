namespace Aitty.Services;

/// <summary>
/// AI 서비스 제공자를 관리하고 전환하는 매니저.
/// 현재 지원: ollama, gemini, claude
/// 추후 확장: openai 등 IAiService 구현체 추가만 하면 됨.
/// API 키 암호화는 추후 단계에서 적용 예정.
/// </summary>
public class AiServiceManager : IDisposable
{
    private readonly LocalLlmService _ollamaService;
    private readonly GeminiService _geminiService;
    private readonly ClaudeApiService _claudeService;

    // API 키 임시 저장 (평문 - 암호화는 추후 단계에서 적용)
    private readonly Dictionary<string, string> _apiKeys = new(StringComparer.OrdinalIgnoreCase);

    private string _activeProvider = "ollama";

    public AiServiceManager()
    {
        _ollamaService = new LocalLlmService();
        _geminiService = new GeminiService();
        _claudeService = new ClaudeApiService();
    }

    /// <summary>현재 활성 제공자 이름</summary>
    public string ActiveProvider => _activeProvider;

    /// <summary>현재 활성 서비스 인스턴스</summary>
    public IAiService Active => _activeProvider switch
    {
        "gemini" => _geminiService,
        "claude" => _claudeService,
        _ => _ollamaService
    };

    /// <summary>Ollama 전용 속성 접근 (endpoint 변경 등)</summary>
    public LocalLlmService Ollama => _ollamaService;

    // ── 제공자 전환 ───────────────────────────────────────── //

    /// <summary>제공자 전환. 지원값: "ollama" | "gemini" | "claude"</summary>
    public void SwitchProvider(string provider)
    {
        var normalized = provider.ToLowerInvariant();
        _activeProvider = normalized switch
        {
            "gemini" => "gemini",
            "claude" => "claude",
            _ => "ollama"
        };
    }

    // ── API 키 관리 ───────────────────────────────────────── //

    /// <summary>API 키 설정 (해당 서비스에 즉시 적용)</summary>
    public void SetApiKey(string provider, string apiKey)
    {
        var normalized = provider.ToLowerInvariant();
        _apiKeys[normalized] = apiKey;

        // 서비스에 즉시 반영
        switch (normalized)
        {
            case "gemini": _geminiService.SetApiKey(apiKey); break;
            case "claude": _claudeService.SetApiKey(apiKey); break;
        }
    }

    /// <summary>API 키 보유 여부</summary>
    public bool HasApiKey(string provider)
        => _apiKeys.TryGetValue(provider.ToLowerInvariant(), out var key)
           && !string.IsNullOrWhiteSpace(key);

    /// <summary>제공자 상태 반환</summary>
    public string GetProviderStatus(string provider) => provider.ToLowerInvariant() switch
    {
        "gemini" => HasApiKey("gemini") ? "configured" : "no-api-key",
        "claude" => HasApiKey("claude") ? "configured" : "no-api-key",
        "ollama" => "local",
        _ => "unknown"
    };

    /// <summary>지원 제공자 목록과 상태</summary>
    public object[] GetProviders() =>
    [
        new { id = "ollama", name = "Ollama (Local)", status = GetProviderStatus("ollama"), requiresApiKey = false },
        new { id = "gemini", name = "Google Gemini", status = GetProviderStatus("gemini"), requiresApiKey = true },
        new { id = "claude", name = "Anthropic Claude", status = GetProviderStatus("claude"), requiresApiKey = true },
    ];

    public void Dispose()
    {
        _ollamaService.Dispose();
        _geminiService.Dispose();
        _claudeService.Dispose();
    }
}
