using System;
using System.Threading;
using System.Windows;

namespace MAX.Desktop;

public partial class App : Application
{
    private Mutex? _instanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _instanceMutex = new Mutex(initiallyOwned: true, name: @"Local\MAX.Companion", out var isFirstInstance);
        if (!isFirstInstance)
        {
            Shutdown();
            return;
        }

        var window = new MainWindow();
        MainWindow = window;
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            _instanceMutex?.ReleaseMutex();
        }
        catch (ApplicationException)
        {
            // The mutex can already have been released during an abnormal shutdown.
        }
        finally
        {
            _instanceMutex?.Dispose();
            _instanceMutex = null;
        }

        base.OnExit(e);
    }
}
