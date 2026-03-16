using System.Text.Json.Serialization;

namespace Aitty.Models;

public class SshConnection : IDisposable
{
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 22;
    public string Username { get; set; } = string.Empty;
    public string? PrivateKey { get; set; }

    // [M-2] Password/Passphrase: 직렬화·영속화 완전 제외
    // ConfigService.SanitizeConnection()에서도 null 처리하지만 모델 레벨에서도 명시
    [JsonIgnore]
    public string? Password { get; set; }

    [JsonIgnore]
    public string? Passphrase { get; set; }

    /// <summary>[M-2] 민감 필드 참조 해제. Disconnect 시 호출.</summary>
    public void Dispose()
    {
        Password = null;
        Passphrase = null;
        GC.SuppressFinalize(this);
    }
}

public class SshConnectionState
{
    public bool IsConnected { get; set; }
    public bool IsConnecting { get; set; }
    public string? Error { get; set; }
    public SshConnection? Connection { get; set; }
    public DateTime? ConnectionTime { get; set; }
}
