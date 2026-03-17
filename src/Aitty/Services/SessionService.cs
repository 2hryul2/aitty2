using System.IO;
using System.Text.Json;
using Aitty.Models;

namespace Aitty.Services;

/// <summary>
/// AI 세션(대화 내역 + 모델 설정)을 %AppData%\ssh-ai-terminal\session.json에 저장/복원.
/// </summary>
public class SessionService
{
    private static readonly string SessionPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ssh-ai-terminal", "session.json");

    private static readonly JsonSerializerOptions WriteOptions =
        new() { WriteIndented = true };

    /// <summary>앱 종료 시 동기 저장 (파일 소용량, 블로킹 무방).</summary>
    public void Save(SessionData data)
    {
        var dir = Path.GetDirectoryName(SessionPath)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(SessionPath, JsonSerializer.Serialize(data, WriteOptions));
    }

    /// <summary>앱 시작 시 비동기 로드. 파일 없으면 null 반환.</summary>
    public async Task<SessionData?> LoadAsync()
    {
        if (!File.Exists(SessionPath)) return null;
        try
        {
            var json = await File.ReadAllTextAsync(SessionPath);
            return JsonSerializer.Deserialize<SessionData>(json);
        }
        catch
        {
            return null; // 손상된 파일 — 무시하고 새 세션 시작
        }
    }
}
