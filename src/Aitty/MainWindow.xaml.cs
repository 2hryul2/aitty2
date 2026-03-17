using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
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
    private readonly SessionService _sessionService;
    private IpcHandler? _ipcHandler;

    // [L-1] index.html 메모리 캐시: 앱 시작 시 1회 로드, 이후 매 요청마다 디스크 I/O 제거
    private byte[]? _indexHtmlCache;

    // [H-3] Release 빌드에서 AITTY_DEV 환경변수 우회 완전 차단
    private static bool IsDev =>
#if DEBUG
        true;
#else
        false;
#endif

    public MainWindow()
    {
        InitializeComponent();

        _sshService = new SshService();
        _configService = new ConfigService();
        _keyManagerService = new KeyManagerService();
        _aiManager = new AiServiceManager();
        _sessionService = new SessionService();

        Loaded += MainWindow_Loaded;

        // 앱 종료 시 세션 자동 저장 (동기, 소용량)
        Closing += (_, _) =>
        {
            try { _sessionService.Save(_aiManager.GetSessionData()); }
            catch { /* 저장 실패가 종료를 막으면 안 됨 */ }
        };

        var exitBinding = new KeyBinding(new RelayCommand(_ => Close()), new KeyGesture(Key.Q, ModifierKeys.Control));
        InputBindings.Add(exitBinding);

        // [H-2] DevTools 메뉴: Debug 빌드에서만 동적으로 추가
#if DEBUG
        AddDebugMenuItems();
#endif
    }

#if DEBUG
    private void AddDebugMenuItems()
    {
        var devToolsItem = new MenuItem
        {
            Header = "Toggle _DevTools",
            InputGestureText = "F12"
        };
        devToolsItem.Click += MenuDevTools_Click;

        if (viewMenu is not null)
            viewMenu.Items.Add(devToolsItem);
    }

    private void MenuDevTools_Click(object sender, RoutedEventArgs e)
        => webView.CoreWebView2?.OpenDevToolsWindow();
#endif

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            // WebView2 user data → %LOCALAPPDATA%\Aitty (빌드 간 안전)
            var userDataFolder = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Aitty", "WebView2");
            Directory.CreateDirectory(userDataFolder);

            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await webView.EnsureCoreWebView2Async(env);

            // ── 이벤트 핸들러 ─────────────────────────────────
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

            // ── 세션 복원 (IPC 등록 전) ───────────────────────
            var restoredSession = await _sessionService.LoadAsync();
            if (restoredSession is not null)
                _aiManager.RestoreSessionData(restoredSession);

            // ── IPC 등록 ──────────────────────────────────────
            _ipcHandler = new IpcHandler(webView, _sshService, _configService, _keyManagerService, _aiManager, _sessionService, restoredSession);
            _ipcHandler.Register();

            // ── 네비게이션 ────────────────────────────────────
            if (IsDev)
            {
                webView.CoreWebView2.Navigate("http://localhost:5173");
            }
            else
            {
                var wwwroot = System.IO.Path.Combine(AppContext.BaseDirectory, "wwwroot");

                // [L-1] index.html 메모리 캐시: 초기화 시점에 1회 로드
                await PreloadIndexHtmlAsync(wwwroot);

                // 가상 호스트 등록
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local", wwwroot,
                    CoreWebView2HostResourceAccessKind.Allow);

                // index.html 요청 가로채기 — crossorigin 속성 제거 (CORS 우회)
                webView.CoreWebView2.AddWebResourceRequestedFilter(
                    "https://app.local/index.html",
                    CoreWebView2WebResourceContext.Document);
                webView.CoreWebView2.WebResourceRequested += (s, args) =>
                {
                    // [L-1] 캐시된 바이트 배열 사용 (디스크 I/O 없음)
                    if (_indexHtmlCache is null) return;

                    args.Response = webView.CoreWebView2.Environment
                        .CreateWebResourceResponse(
                            new MemoryStream(_indexHtmlCache), 200, "OK",
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

    /// <summary>[L-1] index.html을 메모리에 미리 로드. crossorigin 제거 포함.</summary>
    private async Task PreloadIndexHtmlAsync(string wwwroot)
    {
        var indexPath = System.IO.Path.Combine(wwwroot, "index.html");
        if (!File.Exists(indexPath)) return;

        var html = await File.ReadAllTextAsync(indexPath, Encoding.UTF8);
        html = html.Replace(" crossorigin", "");
        _indexHtmlCache = Encoding.UTF8.GetBytes(html);
    }

    private void MenuExit_Click(object sender, RoutedEventArgs e) => Close();
    private void MenuReload_Click(object sender, RoutedEventArgs e) => webView.CoreWebView2?.Reload();

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
