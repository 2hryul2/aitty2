using Aitty.Models;

namespace Aitty.Services;

/// <summary>
/// 모든 AI 서비스 제공자(Ollama, Gemini 등)의 공통 인터페이스.
/// 새 제공자 추가 시 이 인터페이스만 구현하면 됨.
/// </summary>
public interface IAiService : IDisposable
{
    string ProviderName { get; }
    string CurrentModel { get; }
    bool IsConfigured { get; }
    IReadOnlyList<AiChatMessage> History { get; }

    void SetModel(string model);
    void SetSystemPrompt(string? systemPrompt);
    void ClearHistory();

    Task<bool> IsEngineAvailableAsync(CancellationToken ct = default);
    Task<List<string>> ListModelsAsync(CancellationToken ct = default);
    Task<AiChatResponse> SendMessageAsync(string userMessage, CancellationToken ct = default);
    Task<AiChatResponse> SendStreamingAsync(string userMessage, Action<string> onChunk, CancellationToken ct = default);
}
