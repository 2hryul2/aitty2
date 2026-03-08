using System.IO;
using Renci.SshNet;
using Aitty.Models;

namespace Aitty.Services;

public class SshService : IDisposable
{
    private const int MaxRecentLines = 200;
    private SshClient? _client;
    private ShellStream? _shellStream;
    private readonly SshConnectionState _state = new();
    private readonly Queue<string> _recentLines = new();

    public SshConnectionState State => _state;
    public bool IsConnected => _client?.IsConnected == true;

    public async Task<bool> ConnectAsync(SshConnection connection)
    {
        try
        {
            _state.IsConnecting = true;
            _state.Error = null;

            await Task.Run(() =>
            {
                var authMethods = new List<AuthenticationMethod>();

                if (!string.IsNullOrEmpty(connection.PrivateKey))
                {
                    var keyPath = ResolvePath(connection.PrivateKey);
                    var keyFile = string.IsNullOrEmpty(connection.Passphrase)
                        ? new PrivateKeyFile(keyPath)
                        : new PrivateKeyFile(keyPath, connection.Passphrase);
                    authMethods.Add(new PrivateKeyAuthenticationMethod(connection.Username, keyFile));
                }

                if (!string.IsNullOrEmpty(connection.Password))
                {
                    authMethods.Add(new PasswordAuthenticationMethod(connection.Username, connection.Password));
                }

                var connInfo = new ConnectionInfo(connection.Host, connection.Port, connection.Username, authMethods.ToArray())
                {
                    Timeout = TimeSpan.FromSeconds(30)
                };

                _client = new SshClient(connInfo);
                _client.Connect();
                _shellStream = _client.CreateShellStream("xterm", 120, 40, 800, 600, 4096);
            });

            _recentLines.Clear();
            _state.IsConnected = true;
            _state.IsConnecting = false;
            _state.Connection = connection;
            _state.ConnectionTime = DateTime.UtcNow;
            return true;
        }
        catch (Exception ex)
        {
            _state.IsConnected = false;
            _state.IsConnecting = false;
            _state.Error = ex.Message;
            return false;
        }
    }

    public void Disconnect()
    {
        _shellStream?.Close();
        _shellStream?.Dispose();
        _shellStream = null;

        if (_client?.IsConnected == true)
            _client.Disconnect();

        _client?.Dispose();
        _client = null;

        _state.IsConnected = false;
        _state.Connection = null;
    }

    public async Task<string> ExecuteAsync(string command)
    {
        if (_client is not { IsConnected: true })
            throw new InvalidOperationException("SSH not connected");

        return await Task.Run(() =>
        {
            using var cmd = _client.CreateCommand(command);
            cmd.CommandTimeout = TimeSpan.FromSeconds(60);
            var result = cmd.Execute();
            var output = !string.IsNullOrEmpty(cmd.Error) ? result + "\n" + cmd.Error : result;
            Remember(command);
            Remember(output);
            return output;
        });
    }

    public async Task<bool> TestAsync()
    {
        try
        {
            var result = await ExecuteAsync("echo \"SSH connection test\"");
            return result.Contains("connection test");
        }
        catch
        {
            return false;
        }
    }

    public void WriteToShell(string data)
    {
        _shellStream?.Write(data);
        _shellStream?.Flush();
        if (!string.IsNullOrWhiteSpace(data) && data != "\r")
        {
            Remember(data.Replace("\r", string.Empty));
        }
    }

    public string? ReadFromShell()
    {
        if (_shellStream is null || !_shellStream.DataAvailable)
            return null;

        var output = _shellStream.Read();
        Remember(output);
        return output;
    }

    public string GetRecentOutput(int lineCount = 80)
    {
        return string.Join("\n", _recentLines.TakeLast(lineCount));
    }

    public void Dispose()
    {
        Disconnect();
        GC.SuppressFinalize(this);
    }

    private void Remember(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        foreach (var line in text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            _recentLines.Enqueue(line);
            while (_recentLines.Count > MaxRecentLines)
            {
                _recentLines.Dequeue();
            }
        }
    }

    private static string ResolvePath(string path)
    {
        if (path.StartsWith('~'))
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, path[2..]);
        }
        return Path.GetFullPath(path);
    }
}
