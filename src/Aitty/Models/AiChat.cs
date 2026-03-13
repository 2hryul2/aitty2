namespace Aitty.Models;

public class AiChatMessage
{
    public string Role { get; set; } = string.Empty; // "user" | "assistant"
    public string Content { get; set; } = string.Empty;
}

public class AiChatRequest
{
    public string Message { get; set; } = string.Empty;
    public string? Model { get; set; }
    public string? SystemPrompt { get; set; }
    public int? MaxTokens { get; set; }
}

public class AiChatResponse
{
    public string Content { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public string FinishReason { get; set; } = "stop";
    public long DurationMs { get; set; }
}

public class AiConfig
{
    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = "claude-sonnet-4-6-20250514";
    public string? SystemPrompt { get; set; }
    public int MaxTokens { get; set; } = 4096;
}
