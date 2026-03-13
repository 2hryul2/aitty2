using System.Text.Json;
using System.Text.Json.Nodes;
using System.IO;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Web.WebView2.Core;
using Aitty.Models;
using Aitty.Services;

namespace Aitty.Ipc;

public class IpcHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly WebView2 _webView;
    private readonly SshService _sshService;
    private readonly ConfigService _configService;
    private readonly KeyManagerService _keyManagerService;
    private readonly AiServiceManager _aiManager;
    private CancellationTokenSource? _streamingCts;

    public IpcHandler(WebView2 webView, SshService sshService, ConfigService configService, KeyManagerService keyManagerService, AiServiceManager aiManager)
    {
        _webView = webView;
        _sshService = sshService;
        _configService = configService;
        _keyManagerService = keyManagerService;
        _aiManager = aiManager;
    }

    public void Register()
    {
        _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        IpcResponse response;

        try
        {
            var msg = JsonSerializer.Deserialize<IpcMessage>(e.WebMessageAsJson, JsonOptions);
            if (msg is null) return;

            var result = await HandleMessage(msg);
            response = new IpcResponse { Id = msg.Id, Type = $"{msg.Type}:result", Payload = result };
        }
        catch (Exception ex)
        {
            response = new IpcResponse { Id = TryExtractId(e.WebMessageAsJson), Type = "error", Error = ex.Message };
        }

        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, JsonOptions));
    }

    private async Task<object?> HandleMessage(IpcMessage msg)
    {
        return msg.Type switch
        {
            "ssh:connect"              => await HandleSshConnect(msg.Payload),
            "ssh:disconnect"           => HandleSshDisconnect(),
            "ssh:exec"                 => await HandleSshExec(msg.Payload),
            "ssh:test"                 => await HandleSshTest(),
            "ssh:state"                => HandleSshState(),
            "ssh:shell:write"          => HandleSshShellWrite(msg.Payload),
            "ssh:shell:read"           => HandleSshShellRead(),

            "config:load"              => await HandleConfigLoad(),
            "config:save"              => await HandleConfigSave(msg.Payload),
            "config:connections:add"   => await HandleConfigAddConnection(msg.Payload),
            "config:connections:remove"=> await HandleConfigRemoveConnection(msg.Payload),

            "keys:list"                => await HandleKeysList(),
            "keys:validate"            => await HandleKeysValidate(msg.Payload),
            "keys:ssh-config"          => await HandleKeysSshConfig(),

            // ── AI 공통 ──────────────────────────────────── //
            "ai:send"                  => await HandleAiSend(msg.Payload),
            "ai:stream"                => await HandleAiStream(msg),
            "ai:stream:cancel"         => HandleAiStreamCancel(),
            "ai:configure"             => HandleAiConfigure(msg.Payload),
            "ai:set-model"             => HandleAiSetModel(msg.Payload),
            "ai:set-system"            => HandleAiSetSystem(msg.Payload),
            "ai:state"                 => await HandleAiState(),
            "ai:history"               => HandleAiHistory(),
            "ai:clear"                 => HandleAiClear(),
            "ai:models"                => await HandleAiModels(),
            "ai:api-log:save"          => await HandleAiApiLogSave(msg.Payload),

            // ── AI 제공자 관리 ────────────────────────────── //
            "ai:providers"             => HandleAiProviders(),
            "ai:set-provider"          => HandleAiSetProvider(msg.Payload),
            "ai:set-apikey"            => HandleAiSetApiKey(msg.Payload),

            // ── Ollama 전용 ──────────────────────────────── //
            "ai:set-endpoint"          => HandleAiSetEndpoint(msg.Payload),
            "ai:openwebui:diagnose"    => await HandleAiOpenWebUiDiagnose(msg.Payload),

            // ── SSH 분석 ─────────────────────────────────── //
            "ai:ssh:analyze"           => await HandleAiAnalyzeSsh(msg),
            "ai:ssh:suggest-command"   => await HandleAiSuggestCommand(msg),

            "app:version"              => GetAppVersion(),
            _                          => throw new NotSupportedException($"Unknown IPC type: {msg.Type}")
        };
    }

    // ── SSH ────────────────────────────────────────────────── //

    private async Task<object> HandleSshConnect(object? payload)
    {
        var conn = DeserializePayload<SshConnection>(payload);
        var success = await _sshService.ConnectAsync(conn);
        // 실패 시 실제 에러 메시지를 프론트에 전달
        return new { success, error = _sshService.State.Error };
    }

    private object HandleSshDisconnect() { _sshService.Disconnect(); return new { success = true }; }

    private async Task<object> HandleSshExec(object? payload)
    {
        var data = DeserializePayload<CommandPayload>(payload);
        var output = await _sshService.ExecuteAsync(data.Command);
        return new { output };
    }

    private async Task<object> HandleSshTest() => new { success = await _sshService.TestAsync() };

    private object HandleSshState()
    {
        var state = _sshService.State;
        return new { isConnected = _sshService.IsConnected, isConnecting = state.IsConnecting, error = state.Error, host = state.Connection?.Host, connectionTime = state.ConnectionTime?.ToString("o") };
    }

    private object HandleSshShellWrite(object? payload) { _sshService.WriteToShell(DeserializePayload<ShellWritePayload>(payload).Data); return new { success = true }; }
    private object HandleSshShellRead() => new { data = _sshService.ReadFromShell() };

    // ── Config / Keys ──────────────────────────────────────── //

    private async Task<object> HandleConfigLoad() => await _configService.LoadAsync();
    private async Task<object> HandleConfigSave(object? payload) { await _configService.SaveAsync(DeserializePayload<AppConfig>(payload)); return new { success = true }; }
    private async Task<object> HandleConfigAddConnection(object? payload) { await _configService.AddConnectionAsync(DeserializePayload<SshConnection>(payload)); return new { success = true }; }
    private async Task<object> HandleConfigRemoveConnection(object? payload) { await _configService.RemoveConnectionAsync(DeserializePayload<HostPayload>(payload).Host); return new { success = true }; }

    private async Task<object> HandleKeysList() { var keys = await _keyManagerService.FindKeysAsync(); return new { keys, directory = _keyManagerService.GetKeyDirectory() }; }
    private async Task<object> HandleKeysValidate(object? payload) { var valid = await _keyManagerService.IsValidKeyFileAsync(DeserializePayload<KeyPathPayload>(payload).Path); return new { valid }; }
    private async Task<object> HandleKeysSshConfig() => await _keyManagerService.ReadSshConfigAsync();

    // ── AI 공통 ────────────────────────────────────────────── //

    private async Task<object> HandleAiSend(object? payload)
    {
        var data = DeserializePayload<AiChatRequest>(payload);
        var response = await _aiManager.Active.SendMessageAsync(data.Message);
        return new { content = response.Content, model = response.Model, inputTokens = 0, outputTokens = 0 };
    }

    private async Task<object> HandleAiStream(IpcMessage msg)
    {
        var data = DeserializePayload<AiChatRequest>(msg.Payload);
        _streamingCts = new CancellationTokenSource();

        var response = await _aiManager.Active.SendStreamingAsync(data.Message, chunk =>
        {
            var chunkResponse = new IpcResponse { Id = msg.Id, Type = "ai:stream:chunk", Payload = new { chunk } };
            _webView.Dispatcher.Invoke(() => _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(chunkResponse, JsonOptions)));
        }, _streamingCts.Token);

        // Level 3 자동 로그 (fire-and-forget — 로그 실패가 주 기능에 영향 X)
        _ = AiChatLogger.AppendAsync(_aiManager.ActiveProvider, response.Model, null, data.Message, response);

        return new { content = response.Content, done = true };
    }

    private object HandleAiStreamCancel() { _streamingCts?.Cancel(); return new { success = true }; }

    private object HandleAiConfigure(object? payload)
    {
        var cfg = DeserializePayload<AiConfig>(payload);
        if (!string.IsNullOrWhiteSpace(cfg.Model)) _aiManager.Active.SetModel(cfg.Model);
        if (!string.IsNullOrWhiteSpace(cfg.SystemPrompt)) _aiManager.Active.SetSystemPrompt(cfg.SystemPrompt);
        return new { success = true };
    }

    private object HandleAiSetModel(object? payload)
    {
        var model = DeserializePayload<ModelPayload>(payload).Model;
        _aiManager.Active.SetModel(model);
        return new { success = true, model };
    }

    private object HandleAiSetSystem(object? payload)
    {
        _aiManager.Active.SetSystemPrompt(DeserializePayload<SystemPromptPayload>(payload).SystemPrompt);
        return new { success = true };
    }

    private async Task<object> HandleAiState()
    {
        var svc = _aiManager.Active;
        var isConfigured = await svc.IsEngineAvailableAsync();
        var baseUrl = svc is LocalLlmService ollama ? ollama.CurrentBaseUrl : string.Empty;
        return new
        {
            isConfigured,
            model = svc.CurrentModel,
            historyCount = svc.History.Count,
            engine = svc.ProviderName,
            provider = _aiManager.ActiveProvider,
            baseUrl
        };
    }

    private object HandleAiHistory() => new { messages = _aiManager.Active.History.Select(m => new { m.Role, m.Content }).ToList() };

    private object HandleAiClear() { _aiManager.Active.ClearHistory(); return new { success = true }; }

    private async Task<object> HandleAiModels()
    {
        var models = await _aiManager.Active.ListModelsAsync();
        return new { models };
    }

    private async Task<object> HandleAiApiLogSave(object? payload)
    {
        var data = DeserializePayload<ApiLogPayload>(payload);
        var content = data.Content ?? string.Empty;

        var logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ssh-ai-terminal",
            "logs");
        Directory.CreateDirectory(logDir);

        // 일별 단일 파일에 append (연결 트레이스 + 대화 로그 통합)
        var filePath = Path.Combine(logDir, $"api_{DateTime.Now:yyyyMMdd}.log");
        await File.AppendAllTextAsync(filePath, content + Environment.NewLine);

        return new { success = true, path = filePath };
    }

    // ── AI 제공자 관리 ──────────────────────────────────────── //

    private object HandleAiProviders() => new { providers = _aiManager.GetProviders(), active = _aiManager.ActiveProvider };

    private object HandleAiSetProvider(object? payload)
    {
        var data = DeserializePayload<ProviderPayload>(payload);
        _aiManager.SwitchProvider(data.Provider);
        return new { success = true, provider = _aiManager.ActiveProvider };
    }

    private object HandleAiSetApiKey(object? payload)
    {
        var data = DeserializePayload<ApiKeyPayload>(payload);
        _aiManager.SetApiKey(data.Provider, data.ApiKey);
        return new { success = true, provider = data.Provider, hasKey = _aiManager.HasApiKey(data.Provider) };
    }

    // ── Ollama 전용 ────────────────────────────────────────── //

    private object HandleAiSetEndpoint(object? payload)
    {
        _aiManager.Ollama.SetBaseUrl(DeserializePayload<EndpointPayload>(payload).Url);
        return new { success = true, url = _aiManager.Ollama.CurrentBaseUrl };
    }

    private async Task<object> HandleAiOpenWebUiDiagnose(object? payload)
    {
        string? endpoint = null;
        if (payload is not null)
        {
            var data = DeserializePayload<EndpointPayload>(payload);
            if (!string.IsNullOrWhiteSpace(data.Url))
                endpoint = data.Url;
        }

        return await _aiManager.Ollama.DiagnoseOpenWebUiAsync(endpoint);
    }

    // ── SSH 분석 ────────────────────────────────────────────── //

    private async Task<object> HandleAiAnalyzeSsh(IpcMessage msg)
    {
        var lastOutput = _sshService.GetLastCommandOutput();
        if (string.IsNullOrWhiteSpace(lastOutput))
            return new { content = string.Empty };

        var prompt = $"SSH last command output:\n{lastOutput}\n\nAnalyze the output, explain issues if any, and suggest the next safe action.";

        var response = await _aiManager.Active.SendStreamingAsync(prompt, chunk =>
        {
            var chunkResponse = new IpcResponse { Id = msg.Id, Type = "ai:ssh:analyze:chunk", Payload = new { chunk } };
            _webView.Dispatcher.Invoke(() => _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(chunkResponse, JsonOptions)));
        });

        _ = AiChatLogger.AppendAsync(_aiManager.ActiveProvider, response.Model, null, prompt, response);
        return new { content = response.Content };
    }

    private async Task<object> HandleAiSuggestCommand(IpcMessage msg)
    {
        var recentOutput = _sshService.GetRecentOutput();
        if (string.IsNullOrWhiteSpace(recentOutput))
            return new { content = string.Empty };

        var prompt = $"Recent SSH output:\n{recentOutput}\n\nSuggest one safe next shell command only, followed by a short reason.";

        var response = await _aiManager.Active.SendStreamingAsync(prompt, chunk =>
        {
            var chunkResponse = new IpcResponse { Id = msg.Id, Type = "ai:ssh:suggest:chunk", Payload = new { chunk } };
            _webView.Dispatcher.Invoke(() => _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(chunkResponse, JsonOptions)));
        });

        _ = AiChatLogger.AppendAsync(_aiManager.ActiveProvider, response.Model, null, prompt, response);
        return new { content = response.Content };
    }

    private static object GetAppVersion()
    {
        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        return new { version = version?.ToString() ?? "0.1.0" };
    }

    private static T DeserializePayload<T>(object? payload) where T : class
    {
        if (payload is JsonElement element)
            return JsonSerializer.Deserialize<T>(element.GetRawText(), JsonOptions) ?? throw new ArgumentException($"Failed to deserialize {typeof(T).Name}");

        var json = JsonSerializer.Serialize(payload, JsonOptions);
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new ArgumentException($"Failed to deserialize {typeof(T).Name}");
    }

    private static string TryExtractId(string json)
    {
        try { return JsonNode.Parse(json)?["id"]?.GetValue<string>() ?? "unknown"; }
        catch { return "unknown"; }
    }
}

// ── Payload DTOs ──────────────────────────────────────────── //
internal class CommandPayload      { public string Command    { get; set; } = string.Empty; }
internal class ShellWritePayload   { public string Data       { get; set; } = string.Empty; }
internal class HostPayload         { public string Host       { get; set; } = string.Empty; }
internal class KeyPathPayload      { public string Path       { get; set; } = string.Empty; }
internal class ModelPayload        { public string Model      { get; set; } = string.Empty; }
internal class SystemPromptPayload { public string? SystemPrompt { get; set; } }
internal class EndpointPayload     { public string Url        { get; set; } = string.Empty; }
internal class ProviderPayload     { public string Provider   { get; set; } = string.Empty; }
internal class ApiKeyPayload       { public string Provider   { get; set; } = string.Empty; public string ApiKey { get; set; } = string.Empty; }
internal class ApiLogPayload       { public string Content    { get; set; } = string.Empty; }
