namespace Aitty.Models;

/// <summary>
/// AI 세션 스냅샷. 앱 종료 시 session.json으로 저장되고 다음 실행 시 복원.
/// </summary>
public class SessionData
{
    public DateTime SavedAt     { get; set; }
    public string   Engine      { get; set; } = "ollama";
    public string   Provider    { get; set; } = "ollama";
    public string   Model       { get; set; } = "";
    public string?  SystemPrompt { get; set; }
    public List<AiChatMessage> Messages { get; set; } = [];
}
