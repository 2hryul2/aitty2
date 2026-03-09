using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Aitty.Ipc;
using Aitty.Services;

namespace Aitty;

public partial class MainWindow : Window
{
    private readonly SshService _sshService;
    private readonly ConfigService _configService;
    private readonly KeyManagerService _keyManagerService;
    private readonly AiServiceManager _aiManager;
    private IpcHandler? _ipcHandler;

    private static bool IsDev =>
#if DEBUG
        true;
#else
        Environment.GetEnvironmentVariable("AITTY_DEV") == "1";
#endif

    public MainWindow()
    {
        InitializeComponent();

        _sshService = new SshService();
        _configService = new ConfigService();
        _keyManagerService = new KeyManagerService();
        _aiManager = new AiServiceManager();

        Loaded += MainWindow_Loaded;

        var exitBinding = new KeyBinding(new RelayCommand(_ => Close()), new KeyGesture(Key.Q, ModifierKeys.Control));
        InputBindings.Add(exitBinding);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            // WebView2 user data → %LOCALAPPDATA%\Aitty (빌드 간 안전)
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Aitty", "WebView2");
            Directory.CreateDirectory(userDataFolder);

            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await webView.EnsureCoreWebView2Async(env);

            // ── 디버깅 이벤트 ─────────────────────────────────
            webView.CoreWebView2.NavigationCompleted += (s, args) =>
            {
                if (!args.IsSuccess)
                    Dispatcher.BeginInvoke(() =>
                        MessageBox.Show($"Navigation error: {args.WebErrorStatus}\nURL: {webView.Source}",
                            "Navigation Error", MessageBoxButton.OK, MessageBoxImage.Warning));
            };
            webView.CoreWebView2.ProcessFailed += (s, args) =>
                Dispatcher.BeginInvoke(() =>
                    MessageBox.Show($"WebView2 process failed: {args.ProcessFailedKind}",
                        "Error", MessageBoxButton.OK, MessageBoxImage.Error));

            // ── IPC 등록 ──────────────────────────────────────
            _ipcHandler = new IpcHandler(webView, _sshService, _configService, _keyManagerService, _aiManager);
            _ipcHandler.Register();

            // ── 네비게이션 ────────────────────────────────────
            if (IsDev)
            {
                webView.CoreWebView2.Navigate("http://localhost:5173");
            }
            else
            {
                var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");

                // 1) 가상 호스트 등록 (JS/CSS/이미지 등 서빙)
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local", wwwroot,
                    CoreWebView2HostResourceAccessKind.Allow);

                // 2) index.html만 가로채서 crossorigin 속성 제거
                //    (WebView2 virtual host + module script CORS 문제 우회)
                webView.CoreWebView2.AddWebResourceRequestedFilter(
                    "https://app.local/index.html",
                    CoreWebView2WebResourceContext.Document);
                webView.CoreWebView2.WebResourceRequested += (s, args) =>
                {
                    var indexPath = Path.Combine(wwwroot, "index.html");
                    if (!File.Exists(indexPath)) return;

                    var html = File.ReadAllText(indexPath, Encoding.UTF8);
                    html = html.Replace(" crossorigin", "");
                    var bytes = Encoding.UTF8.GetBytes(html);

                    args.Response = webView.CoreWebView2.Environment
                        .CreateWebResourceResponse(
                            new MemoryStream(bytes), 200, "OK",
                            "Content-Type: text/html; charset=utf-8");
                };

                webView.CoreWebView2.Navigate("https://app.local/index.html");
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"WebView2 초기화 실패:\n{ex.Message}\n\n{ex.StackTrace}",
                "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void MenuExit_Click(object sender, RoutedEventArgs e) => Close();
    private void MenuReload_Click(object sender, RoutedEventArgs e) => webView.CoreWebView2?.Reload();
    private void MenuDevTools_Click(object sender, RoutedEventArgs e) => webView.CoreWebView2?.OpenDevToolsWindow();

    protected override void OnClosed(EventArgs e)
    {
        _sshService.Dispose();
        _aiManager.Dispose();
        webView.Dispose();
        base.OnClosed(e);
    }
}

public class RelayCommand : ICommand
{
    private readonly Action<object?> _execute;
    public RelayCommand(Action<object?> execute) => _execute = execute;
    public event EventHandler? CanExecuteChanged;
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter) => _execute(parameter);
}
