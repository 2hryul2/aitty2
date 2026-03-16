using System.IO;
using System.Runtime.InteropServices;

namespace Aitty.Services;

public class KeyManagerService
{
    private readonly string _sshDir;

    public KeyManagerService()
    {
        _sshDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh");
    }

    public Task<List<string>> FindKeysAsync()
    {
        var keys = new List<string>();
        var commonNames = new[] { "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa" };

        foreach (var name in commonNames)
        {
            var keyPath = Path.Combine(_sshDir, name);
            if (File.Exists(keyPath))
                keys.Add(keyPath);
        }

        return Task.FromResult(keys);
    }

    public Task<bool> KeyExistsAsync(string keyPath)
    {
        return Task.FromResult(File.Exists(keyPath));
    }

    public async Task<Dictionary<string, Dictionary<string, string>>> ReadSshConfigAsync()
    {
        var configPath = Path.Combine(_sshDir, "config");
        if (!File.Exists(configPath))
            return new Dictionary<string, Dictionary<string, string>>();

        var content = await File.ReadAllTextAsync(configPath);
        return ParseSshConfig(content);
    }

    // ── 보안: Path Traversal 방어 ────────────────────────────── //

    /// <summary>
    /// 허용된 디렉토리(~/.ssh) 하위 경로인지 검증.
    /// FileInfo.FullName으로 심볼릭 링크·상대경로를 모두 정규화한 뒤 비교.
    /// </summary>
    internal bool IsPathAllowed(string keyPath)
    {
        try
        {
            // UNC 경로(\\server\share) 즉시 거부
            if (keyPath.StartsWith("\\\\") || keyPath.StartsWith("//"))
                return false;

            var fullPath = new FileInfo(keyPath).FullName;
            var fullBase = new FileInfo(_sshDir).FullName;

            // Windows: 대소문자 무시 / Linux: 구분
            var comparison = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;

            // baseDir 자신 제외하고 하위 경로만 허용
            var separator = Path.DirectorySeparatorChar.ToString();
            return fullPath.StartsWith(fullBase + separator, comparison);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// SSH 개인키 파일 유효성 검사.
    /// - 경로 화이트리스트 검증 먼저 수행
    /// - 파일 크기 1MB 초과 거부
    /// - 첫 10줄만 읽어 헤더 확인 (전체 읽기 제거)
    /// </summary>
    public async Task<bool> IsValidKeyFileAsync(string keyPath)
    {
        // [C-1] Path Traversal 방어: ~/.ssh 하위만 허용
        if (!IsPathAllowed(keyPath))
            return false; // 묵시적 거부 (경로 정보 미노출)

        try
        {
            var fileInfo = new FileInfo(keyPath);

            // [L-2] 파일 크기 사전 검사: 1MB 초과는 개인키가 아님
            if (fileInfo.Length > 1_048_576)
                return false;

            // 첫 10줄만 읽어 PEM 헤더 확인
            using var reader = new StreamReader(keyPath);
            for (int i = 0; i < 10; i++)
            {
                var line = await reader.ReadLineAsync();
                if (line is null) break;
                if (line.Contains("BEGIN") && line.Contains("PRIVATE KEY"))
                    return true;
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    public string GetKeyDirectory() => _sshDir;

    private static Dictionary<string, Dictionary<string, string>> ParseSshConfig(string content)
    {
        var config = new Dictionary<string, Dictionary<string, string>>();
        var currentHost = string.Empty;

        foreach (var line in content.Split('\n'))
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#'))
                continue;

            if (trimmed.StartsWith("Host ", StringComparison.OrdinalIgnoreCase))
            {
                currentHost = trimmed[5..].Trim();
                config[currentHost] = new Dictionary<string, string>();
            }
            else if (!string.IsNullOrEmpty(currentHost))
            {
                var parts = trimmed.Split(new[] { ' ', '\t' }, 2, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 2)
                    config[currentHost][parts[0].ToLowerInvariant()] = parts[1];
            }
        }

        return config;
    }
}
