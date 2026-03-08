using System.Text.Json;
using System.Text.Json.Nodes;
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
    private readonly LocalLlmService _localLlmService;
    private CancellationTokenSource? _streamingCts;

    public IpcHandler(WebView2 webView, SshService sshService, ConfigService configService, KeyManagerService keyManagerService, LocalLlmService localLlmService)
    {
        _webView = webView;
        _sshService = sshService;
        _configService = configService;
        _keyManagerService = keyManagerService;
        _localLlmService = localLlmService;
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
            "ssh:connect" => await HandleSshConnect(msg.Payload),
            "ssh:disconnect" => HandleSshDisconnect(),
            "ssh:exec" => await HandleSshExec(msg.Payload),
            "ssh:test" => await HandleSshTest(),
            "ssh:state" => HandleSshState(),
            "ssh:shell:write" => HandleSshShellWrite(msg.Payload),
            "ssh:shell:read" => HandleSshShellRead(),

            "config:load" => await HandleConfigLoad(),
            "config:save" => await HandleConfigSave(msg.Payload),
            "config:connections:add" => await HandleConfigAddConnection(msg.Payload),
            "config:connections:remove" => await HandleConfigRemoveConnection(msg.Payload),

            "keys:list" => await HandleKeysList(),
            "keys:validate" => await HandleKeysValidate(msg.Payload),
            "keys:ssh-config" => await HandleKeysSshConfig(),

            "ai:send" => await HandleAiSend(msg.Payload),
            "ai:stream" => await HandleAiStream(msg),
            "ai:stream:cancel" => HandleAiStreamCancel(),
            "ai:configure" => HandleAiConfigure(msg.Payload),
            "ai:set-model" => HandleAiSetModel(msg.Payload),
            "ai:set-system" => HandleAiSetSystem(msg.Payload),
            "ai:state" => await HandleAiState(),
            "ai:history" => HandleAiHistory(),
            "ai:clear" => HandleAiClear(),
            "ai:models" => await HandleAiModels(),
            "ai:ssh:analyze" => await HandleAiAnalyzeSsh(),
            "ai:ssh:suggest-command" => await HandleAiSuggestCommand(),

            "app:version" => GetAppVersion(),
            _ => throw new NotSupportedException($"Unknown IPC type: {msg.Type}")
        };
    }

    private async Task<object> HandleSshConnect(object? payload)
    {
        var conn = DeserializePayload<SshConnection>(payload);
        var success = await _sshService.ConnectAsync(conn);
        return new { success };
    }

    private object HandleSshDisconnect()
    {
        _sshService.Disconnect();
        return new { success = true };
    }

    private async Task<object> HandleSshExec(object? payload)
    {
        var data = DeserializePayload<CommandPayload>(payload);
        var output = await _sshService.ExecuteAsync(data.Command);
        return new { output };
    }

    private async Task<object> HandleSshTest()
    {
        var ok = await _sshService.TestAsync();
        return new { success = ok };
    }

    private object HandleSshState()
    {
        var state = _sshService.State;
        return new { isConnected = _sshService.IsConnected, isConnecting = state.IsConnecting, error = state.Error, host = state.Connection?.Host, connectionTime = state.ConnectionTime?.ToString("o") };
    }

    private object HandleSshShellWrite(object? payload)
    {
        var data = DeserializePayload<ShellWritePayload>(payload);
        _sshService.WriteToShell(data.Data);
        return new { success = true };
    }

    private object HandleSshShellRead()
    {
        return new { data = _sshService.ReadFromShell() };
    }

    private async Task<object> HandleConfigLoad() => await _configService.LoadAsync();
    private async Task<object> HandleConfigSave(object? payload) { await _configService.SaveAsync(DeserializePayload<AppConfig>(payload)); return new { success = true }; }
    private async Task<object> HandleConfigAddConnection(object? payload) { await _configService.AddConnectionAsync(DeserializePayload<SshConnection>(payload)); return new { success = true }; }
    private async Task<object> HandleConfigRemoveConnection(object? payload) { await _configService.RemoveConnectionAsync(DeserializePayload<HostPayload>(payload).Host); return new { success = true }; }

    private async Task<object> HandleKeysList() { var keys = await _keyManagerService.FindKeysAsync(); return new { keys, directory = _keyManagerService.GetKeyDirectory() }; }
    private async Task<object> HandleKeysValidate(object? payload) { var valid = await _keyManagerService.IsValidKeyFileAsync(DeserializePayload<KeyPathPayload>(payload).Path); return new { valid }; }
    private async Task<object> HandleKeysSshConfig() => await _keyManagerService.ReadSshConfigAsync();

    private async Task<object> HandleAiSend(object? payload)
    {
        var data = DeserializePayload<AiChatRequest>(payload);
        var response = await _localLlmService.SendMessageAsync(data.Message);
        return new { content = response.Content, model = response.Model, inputTokens = 0, outputTokens = 0 };
    }

    private async Task<object> HandleAiStream(IpcMessage msg)
    {
        var data = DeserializePayload<AiChatRequest>(msg.Payload);
        _streamingCts = new CancellationTokenSource();

        var fullContent = await _localLlmService.SendStreamingAsync(data.Message, chunk =>
        {
            var chunkResponse = new IpcResponse { Id = msg.Id, Type = "ai:stream:chunk", Payload = new { chunk } };
            var chunkJson = JsonSerializer.Serialize(chunkResponse, JsonOptions);
            _webView.Dispatcher.Invoke(() => _webView.CoreWebView2.PostWebMessageAsJson(chunkJson));
        }, _streamingCts.Token);

        return new { content = fullContent, done = true };
    }

    private object HandleAiStreamCancel()
    {
        _streamingCts?.Cancel();
        return new { success = true };
    }

    private object HandleAiConfigure(object? payload)
    {
        _localLlmService.Configure(DeserializePayload<AiConfig>(payload));
        return new { success = true };
    }

    private object HandleAiSetModel(object? payload)
    {
        var model = DeserializePayload<ModelPayload>(payload).Model;
        _localLlmService.SetModel(model);
        return new { success = true, model };
    }

    private object HandleAiSetSystem(object? payload)
    {
        _localLlmService.SetSystemPrompt(DeserializePayload<SystemPromptPayload>(payload).SystemPrompt);
        return new { success = true };
    }

    private async Task<object> HandleAiState()
    {
        return new { isConfigured = await _localLlmService.IsEngineAvailableAsync(), model = _localLlmService.CurrentModel, historyCount = _localLlmService.History.Count, engine = "ollama" };
    }

    private object HandleAiHistory()
    {
        return new { messages = _localLlmService.History.Select(m => new { m.Role, m.Content }).ToList() };
    }

    private object HandleAiClear()
    {
        _localLlmService.ClearHistory();
        return new { success = true };
    }

    private async Task<object> HandleAiModels()
    {
        var models = await _localLlmService.ListModelsAsync();
        return new { models };
    }

    private async Task<object> HandleAiAnalyzeSsh()
    {
        var content = await _localLlmService.AnalyzeSshOutputAsync(_sshService.GetRecentOutput());
        return new { content };
    }

    private async Task<object> HandleAiSuggestCommand()
    {
        var content = await _localLlmService.SuggestCommandAsync(_sshService.GetRecentOutput());
        return new { content };
    }

    private static object GetAppVersion()
    {
        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        return new { version = version?.ToString() ?? "0.1.0" };
    }

    private static T DeserializePayload<T>(object? payload) where T : class
    {
        if (payload is JsonElement element)
        {
            return JsonSerializer.Deserialize<T>(element.GetRawText(), JsonOptions) ?? throw new ArgumentException($"Failed to deserialize payload to {typeof(T).Name}");
        }

        var json = JsonSerializer.Serialize(payload, JsonOptions);
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new ArgumentException($"Failed to deserialize payload to {typeof(T).Name}");
    }

    private static string TryExtractId(string json)
    {
        try
        {
            var node = JsonNode.Parse(json);
            return node?["id"]?.GetValue<string>() ?? "unknown";
        }
        catch
        {
            return "unknown";
        }
    }
}

internal class CommandPayload { public string Command { get; set; } = string.Empty; }
internal class ShellWritePayload { public string Data { get; set; } = string.Empty; }
internal class HostPayload { public string Host { get; set; } = string.Empty; }
internal class KeyPathPayload { public string Path { get; set; } = string.Empty; }
internal class ModelPayload { public string Model { get; set; } = string.Empty; }
internal class SystemPromptPayload { public string? SystemPrompt { get; set; } }
