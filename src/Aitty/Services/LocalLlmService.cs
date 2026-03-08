using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Aitty.Models;

namespace Aitty.Services;

public class LocalLlmService : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly List<AiChatMessage> _conversationHistory = new();

    private string _baseUrl = "http://localhost:11434";
    private string _model = "qwen2.5-coder:7b";
    private string? _systemPrompt = "You are a local Linux SSH assistant. Analyze terminal output, explain issues, and suggest safe next commands. Prefer minimal-risk commands first.";

    public LocalLlmService()
    {
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromMinutes(5)
        };
    }

    public bool IsConfigured => true;
    public string CurrentModel => _model;
    public IReadOnlyList<AiChatMessage> History => _conversationHistory.AsReadOnly();

    public void Configure(AiConfig config)
    {
        if (!string.IsNullOrWhiteSpace(config.Model))
        {
            _model = config.Model;
        }

        if (!string.IsNullOrWhiteSpace(config.SystemPrompt))
        {
            _systemPrompt = config.SystemPrompt;
        }
    }

    public void SetModel(string model)
    {
        _model = model;
    }

    public void SetSystemPrompt(string? systemPrompt)
    {
        _systemPrompt = systemPrompt;
    }

    public async Task<List<string>> ListModelsAsync(CancellationToken ct = default)
    {
        using var response = await _httpClient.GetAsync($"{_baseUrl}/api/tags", ct);
        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

        var models = new List<string>();
        if (doc.RootElement.TryGetProperty("models", out var modelArray))
        {
            foreach (var item in modelArray.EnumerateArray())
            {
                if (item.TryGetProperty("name", out var name))
                {
                    var value = name.GetString();
                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        models.Add(value);
                    }
                }
            }
        }

        return models;
    }

    public async Task<bool> IsEngineAvailableAsync(CancellationToken ct = default)
    {
        try
        {
            _ = await ListModelsAsync(ct);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<AiChatResponse> SendMessageAsync(string userMessage, CancellationToken ct = default)
    {
        _conversationHistory.Add(new AiChatMessage { Role = "user", Content = userMessage });

        var request = BuildChatRequest(userMessage, includeHistory: true, stream: false);
        var json = JsonSerializer.Serialize(request);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await _httpClient.PostAsync($"{_baseUrl}/api/chat", content, ct);
        var responseText = await response.Content.ReadAsStringAsync(ct);
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(responseText);
        var message = doc.RootElement.GetProperty("message").GetProperty("content").GetString() ?? string.Empty;

        _conversationHistory.Add(new AiChatMessage { Role = "assistant", Content = message });

        return new AiChatResponse
        {
            Content = message,
            Model = _model,
            InputTokens = 0,
            OutputTokens = 0
        };
    }

    public async Task<string> SendStreamingAsync(string userMessage, Action<string> onChunk, CancellationToken ct = default)
    {
        _conversationHistory.Add(new AiChatMessage { Role = "user", Content = userMessage });

        var request = BuildChatRequest(userMessage, includeHistory: true, stream: true);
        var json = JsonSerializer.Serialize(request);
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/chat")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };

        using var response = await _httpClient.SendAsync(httpRequest, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        var builder = new StringBuilder();
        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            using var doc = JsonDocument.Parse(line);
            if (doc.RootElement.TryGetProperty("message", out var message) &&
                message.TryGetProperty("content", out var contentElement))
            {
                var chunk = contentElement.GetString() ?? string.Empty;
                if (chunk.Length > 0)
                {
                    builder.Append(chunk);
                    onChunk(chunk);
                }
            }

            if (doc.RootElement.TryGetProperty("done", out var doneElement) && doneElement.GetBoolean())
            {
                break;
            }
        }

        var fullContent = builder.ToString();
        _conversationHistory.Add(new AiChatMessage { Role = "assistant", Content = fullContent });
        return fullContent;
    }

    public async Task<string> AnalyzeSshOutputAsync(string recentOutput, CancellationToken ct = default)
    {
        var prompt = $"Recent SSH output:\n{recentOutput}\n\nAnalyze the output, explain issues if any, and suggest the next safe action.";
        var response = await SendMessageAsync(prompt, ct);
        return response.Content;
    }

    public async Task<string> SuggestCommandAsync(string recentOutput, CancellationToken ct = default)
    {
        var prompt = $"Recent SSH output:\n{recentOutput}\n\nSuggest one safe next shell command only, followed by a short reason.";
        var response = await SendMessageAsync(prompt, ct);
        return response.Content;
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

    private object BuildChatRequest(string userMessage, bool includeHistory, bool stream)
    {
        var messages = new List<object>();
        if (includeHistory)
        {
            foreach (var item in _conversationHistory)
            {
                messages.Add(new { role = item.Role, content = item.Content });
            }
        }
        else
        {
            messages.Add(new { role = "user", content = userMessage });
        }

        return new
        {
            model = _model,
            stream,
            messages,
            options = new
            {
                temperature = 0.2
            },
            system = _systemPrompt
        };
    }
}
