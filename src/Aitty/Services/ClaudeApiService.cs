using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Aitty.Models;

namespace Aitty.Services;

public class ClaudeApiService : IAiService
{
    private const string ApiUrl = "https://api.anthropic.com/v1/messages";
    private const string ApiVersion = "2023-06-01";
    private const string DefaultModel = "claude-sonnet-4-5-20250929";

    private static readonly string[] KnownModels =
    [
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
        "claude-opus-4-5-20251101",
        "claude-sonnet-4-5-20250929",
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _httpClient;
    private readonly List<AiChatMessage> _conversationHistory = new();

    private string _apiKey = string.Empty;
    private string _model = DefaultModel;
    private string? _systemPrompt;
    private int _maxTokens = 4096;

    public string ProviderName => "claude";
    public bool IsConfigured => !string.IsNullOrEmpty(_apiKey);
    public string CurrentModel => _model;
    public IReadOnlyList<AiChatMessage> History => _conversationHistory.AsReadOnly();

    public Task<bool> IsEngineAvailableAsync(CancellationToken ct = default)
        => Task.FromResult(IsConfigured);

    public Task<List<string>> ListModelsAsync(CancellationToken ct = default)
        => Task.FromResult(new List<string>(KnownModels));

    public ClaudeApiService()
    {
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Add("anthropic-version", ApiVersion);
    }

    public void Configure(AiConfig config)
    {
        _apiKey = config.ApiKey;
        _model = string.IsNullOrEmpty(config.Model) ? DefaultModel : config.Model;
        _systemPrompt = config.SystemPrompt;
        _maxTokens = config.MaxTokens > 0 ? config.MaxTokens : 4096;

        _httpClient.DefaultRequestHeaders.Remove("x-api-key");
        _httpClient.DefaultRequestHeaders.Add("x-api-key", _apiKey);
    }

    public void SetApiKey(string apiKey)
    {
        _apiKey = apiKey;
        _httpClient.DefaultRequestHeaders.Remove("x-api-key");
        _httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
    }

    public void SetModel(string model)
    {
        _model = model;
    }

    public void SetSystemPrompt(string? systemPrompt)
    {
        _systemPrompt = systemPrompt;
    }

    public async Task<AiChatResponse> SendMessageAsync(string userMessage, CancellationToken ct = default)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("Claude API key not configured. Use 'config set api-key <KEY>' to set it.");

        _conversationHistory.Add(new AiChatMessage { Role = "user", Content = userMessage });

        var requestBody = new ClaudeRequest
        {
            Model = _model,
            MaxTokens = _maxTokens,
            System = _systemPrompt,
            Messages = _conversationHistory.Select(m => new ClaudeMessageItem
            {
                Role = m.Role,
                Content = m.Content
            }).ToList()
        };

        var json = JsonSerializer.Serialize(requestBody, JsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync(ApiUrl, content, ct);
        var responseJson = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            _conversationHistory.RemoveAt(_conversationHistory.Count - 1);
            var errorDetail = TryExtractError(responseJson);
            throw new HttpRequestException($"Claude API error ({response.StatusCode}): {errorDetail}");
        }

        var result = JsonSerializer.Deserialize<ClaudeResponse>(responseJson, JsonOptions);
        if (result is null)
            throw new InvalidOperationException("Failed to parse Claude API response");

        var assistantContent = string.Join("\n",
            result.Content?.Where(c => c.Type == "text").Select(c => c.Text) ?? []);

        _conversationHistory.Add(new AiChatMessage { Role = "assistant", Content = assistantContent });

        return new AiChatResponse
        {
            Content = assistantContent,
            Model = result.Model ?? _model,
            InputTokens = result.Usage?.InputTokens ?? 0,
            OutputTokens = result.Usage?.OutputTokens ?? 0
        };
    }

    public async Task<string> SendStreamingAsync(string userMessage, Action<string> onChunk, CancellationToken ct = default)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("Claude API key not configured. Use 'config set api-key <KEY>' to set it.");

        _conversationHistory.Add(new AiChatMessage { Role = "user", Content = userMessage });

        var requestBody = new ClaudeRequest
        {
            Model = _model,
            MaxTokens = _maxTokens,
            System = _systemPrompt,
            Stream = true,
            Messages = _conversationHistory.Select(m => new ClaudeMessageItem
            {
                Role = m.Role,
                Content = m.Content
            }).ToList()
        };

        var json = JsonSerializer.Serialize(requestBody, JsonOptions);
        var request = new HttpRequestMessage(HttpMethod.Post, ApiUrl)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };

        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);

        if (!response.IsSuccessStatusCode)
        {
            _conversationHistory.RemoveAt(_conversationHistory.Count - 1);
            var errorJson = await response.Content.ReadAsStringAsync(ct);
            var errorDetail = TryExtractError(errorJson);
            throw new HttpRequestException($"Claude API error ({response.StatusCode}): {errorDetail}");
        }

        var fullContent = new StringBuilder();
        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrEmpty(line)) continue;

            if (!line.StartsWith("data: ")) continue;
            var data = line[6..];
            if (data == "[DONE]") break;

            try
            {
                var sseEvent = JsonSerializer.Deserialize<ClaudeSseEvent>(data, JsonOptions);
                if (sseEvent?.Type == "content_block_delta" && sseEvent.Delta?.Text is not null)
                {
                    fullContent.Append(sseEvent.Delta.Text);
                    onChunk(sseEvent.Delta.Text);
                }
            }
            catch
            {
                // Skip malformed SSE events
            }
        }

        var result = fullContent.ToString();
        _conversationHistory.Add(new AiChatMessage { Role = "assistant", Content = result });
        return result;
    }

    public void ClearHistory()
    {
        _conversationHistory.Clear();
    }

    public void Dispose()
    {
        _httpClient.Dispose();
        GC.SuppressFinalize(this);
    }

    private static string TryExtractError(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("error", out var error))
            {
                if (error.TryGetProperty("message", out var msg))
                    return msg.GetString() ?? json;
            }
        }
        catch { }
        return json;
    }
}

// Claude API request/response DTOs
internal class ClaudeRequest
{
    public string Model { get; set; } = string.Empty;
    public int MaxTokens { get; set; }
    public string? System { get; set; }
    public bool? Stream { get; set; }
    public List<ClaudeMessageItem> Messages { get; set; } = new();
}

internal class ClaudeMessageItem
{
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}

internal class ClaudeResponse
{
    public string? Model { get; set; }
    public List<ClaudeContentBlock>? Content { get; set; }
    public ClaudeUsage? Usage { get; set; }
}

internal class ClaudeContentBlock
{
    public string Type { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

internal class ClaudeUsage
{
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
}

internal class ClaudeSseEvent
{
    public string? Type { get; set; }
    public ClaudeSseDelta? Delta { get; set; }
}

internal class ClaudeSseDelta
{
    public string? Type { get; set; }
    public string? Text { get; set; }
}
