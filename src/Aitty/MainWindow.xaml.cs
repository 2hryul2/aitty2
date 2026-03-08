using System.Diagnostics;
using System.IO;
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
    private readonly LocalLlmService _localLlmService;
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
        _localLlmService = new LocalLlmService();

        Loaded += MainWindow_Loaded;

        var exitBinding = new KeyBinding(new RelayCommand(_ => Close()), new KeyGesture(Key.Q, ModifierKeys.Control));
        InputBindings.Add(exitBinding);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await webView.EnsureCoreWebView2Async();

            _ipcHandler = new IpcHandler(webView, _sshService, _configService, _keyManagerService, _localLlmService);
            _ipcHandler.Register();

            if (IsDev)
            {
                webView.CoreWebView2.Navigate("http://localhost:5173");
            }
            else
            {
                var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping("app.local", wwwroot, CoreWebView2HostResourceAccessKind.Allow);
                webView.CoreWebView2.Navigate("https://app.local/index.html");
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"WebView2 initialization failed:\n{ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void MenuExit_Click(object sender, RoutedEventArgs e) => Close();
    private void MenuReload_Click(object sender, RoutedEventArgs e) => webView.CoreWebView2?.Reload();
    private void MenuDevTools_Click(object sender, RoutedEventArgs e) => webView.CoreWebView2?.OpenDevToolsWindow();

    protected override void OnClosed(EventArgs e)
    {
        _sshService.Dispose();
        _localLlmService.Dispose();
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
