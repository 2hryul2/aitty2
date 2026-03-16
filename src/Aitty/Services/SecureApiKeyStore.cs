using System.Security.Cryptography;
using System.Text;

namespace Aitty.Services;

/// <summary>
/// [H-1] API Key DPAPI 암호화 저장소.
/// Windows DPAPI (ProtectedData.Protect) 로 메모리 내 API 키를 암호화.
/// - 세션별 일회성 Entropy: 프로세스 외부에서 복호화 불가
/// - 앱 재시작 시 키 초기화 (의도적 설계 — 재입력 유도)
/// - 평문 Dictionary 완전 대체
/// </summary>
public sealed class SecureApiKeyStore : IDisposable
{
    private readonly byte[] _entropy;
    private readonly Dictionary<string, byte[]> _encryptedKeys = new(StringComparer.OrdinalIgnoreCase);
    private bool _disposed;

    public SecureApiKeyStore()
    {
        _entropy = new byte[32];
        RandomNumberGenerator.Fill(_entropy);
    }

    /// <summary>API 키 암호화 저장. 평문 바이트는 저장 직후 소거.</summary>
    public void Set(string provider, string apiKey)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var plain = Encoding.UTF8.GetBytes(apiKey);
        try
        {
            var encrypted = ProtectedData.Protect(plain, _entropy, DataProtectionScope.CurrentUser);
            // 이전 값이 있으면 소거
            if (_encryptedKeys.TryGetValue(provider, out var old))
                Array.Clear(old, 0, old.Length);
            _encryptedKeys[provider] = encrypted;
        }
        finally
        {
            Array.Clear(plain, 0, plain.Length); // 평문 즉시 소거
        }
    }

    /// <summary>API 키 복호화 반환. 호출자는 사용 후 문자열 참조를 즉시 버려야 함.</summary>
    public string? Get(string provider)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (!_encryptedKeys.TryGetValue(provider, out var encrypted))
            return null;

        try
        {
            var plain = ProtectedData.Unprotect(encrypted, _entropy, DataProtectionScope.CurrentUser);
            var key = Encoding.UTF8.GetString(plain);
            Array.Clear(plain, 0, plain.Length); // 복호화 버퍼 즉시 소거
            return key;
        }
        catch (CryptographicException)
        {
            return null; // 복호화 실패 (손상 또는 권한 변경)
        }
    }

    /// <summary>해당 제공자의 API 키 보유 여부 확인.</summary>
    public bool Has(string provider)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return _encryptedKeys.ContainsKey(provider);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var enc in _encryptedKeys.Values)
            Array.Clear(enc, 0, enc.Length);
        _encryptedKeys.Clear();
        Array.Clear(_entropy, 0, _entropy.Length);
    }
}
