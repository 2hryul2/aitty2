using System.IO;
using System.Text;
using Aitty.Models;

namespace Aitty.Services;

/// <summary>
/// Level 3 AI 대화 로그 — 일별 단일 파일에 REQUEST/RESPONSE 쌍을 append.
/// 경로: %AppData%\ssh-ai-terminal\logs\api_YYYYMMDD.log
/// </summary>
public static class AiChatLogger
{
    private const int MaxSystemPreview  = 300;
    private const int MaxUserPreview    = 500;
    private const int MaxContentPreview = 600;

    private static readonly string LogDirectory =
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ssh-ai-terminal", "logs");

    public static async Task AppendAsync(
        string          provider,
        string          model,
        string?         systemPrompt,
        string          userMessage,
        AiChatResponse  response,
        CancellationToken ct = default)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);

            var filePath = Path.Combine(
                LogDirectory,
                $"api_{DateTime.Now:yyyyMMdd}.log");

            var sb = new StringBuilder();
            var now = DateTime.Now;

            sb.AppendLine("================================================================================");
            sb.AppendLine($"[{now:yyyy-MM-dd HH:mm:ss.fff}] CHAT — {provider} | {model} | {response.DurationMs}ms");
            sb.AppendLine("================================================================================");

            // REQUEST
            sb.AppendLine("[REQUEST]");
            if (!string.IsNullOrWhiteSpace(systemPrompt))
                sb.AppendLine($"  System : {Truncate(systemPrompt, MaxSystemPreview)}");
            sb.AppendLine($"  User   : {Truncate(userMessage, MaxUserPreview)}");
            sb.AppendLine();

            // RESPONSE
            sb.AppendLine("[RESPONSE]");
            sb.AppendLine($"  Content      : {Truncate(response.Content, MaxContentPreview)}");
            sb.AppendLine($"  finish_reason: {response.FinishReason}");
            sb.AppendLine($"  Usage        : input={response.InputTokens} / output={response.OutputTokens} / total={response.InputTokens + response.OutputTokens}");
            sb.AppendLine();
            sb.AppendLine("--------------------------------------------------------------------------------");
            sb.AppendLine();

            await File.AppendAllTextAsync(filePath, sb.ToString(), Encoding.UTF8, ct);
        }
        catch
        {
            // 로그 실패가 주 기능에 영향을 주지 않도록 무시
        }
    }

    private static string Truncate(string text, int maxLen)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        var oneLine = text.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ');
        return oneLine.Length <= maxLen ? oneLine : oneLine[..maxLen] + "…";
    }
}
