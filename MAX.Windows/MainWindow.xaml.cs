using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Win32;
using MAX.Desktop.Assistant;
using Forms = System.Windows.Forms;

namespace MAX.Desktop;

public partial class MainWindow : Window
{
    private const string RunRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "MAXCompanion";

    private readonly WindowsVoiceAssistant? _voiceAssistant;
    private readonly Forms.NotifyIcon _trayIcon;
    private bool _exitRequested;

    public MainWindow()
    {
        InitializeComponent();
        PositionAtDesktopCorner();
        StartIdleAnimation();

        _trayIcon = CreateTrayIcon();

        try
        {
            _voiceAssistant = new WindowsVoiceAssistant(new CommandRouter());
            _voiceAssistant.StatusChanged += VoiceAssistant_StatusChanged;
            _voiceAssistant.Heard += VoiceAssistant_Heard;
            _voiceAssistant.Replied += VoiceAssistant_Replied;
            _voiceAssistant.MicrophoneLevelChanged += VoiceAssistant_MicrophoneLevelChanged;
            _voiceAssistant.PublishCurrentStatus();
        }
        catch (Exception ex)
        {
            SetVisualState("OFFLINE", "Speech not ready. Check Speech and Microphone settings from the tray, then restart MAX.");
            ModeBadge.Foreground = System.Windows.Media.Brushes.DarkRed;
            ModeBadge.ToolTip = ex.Message;
            Debug.WriteLine($"MAX voice startup failed: {ex}");
        }

        Closing += MainWindow_Closing;
    }

    private void PositionAtDesktopCorner()
    {
        var workArea = SystemParameters.WorkArea;
        Left = Math.Max(workArea.Left + 12, workArea.Right - Width - 24);
        Top = Math.Max(workArea.Top + 12, workArea.Bottom - Height - 20);
    }

    private void PetImage_ImageFailed(object sender, System.Windows.ExceptionRoutedEventArgs e)
    {
        PetImage.Visibility = Visibility.Collapsed;
        PetFallback.Visibility = Visibility.Visible;
        StatusText.Text = "MAX's picture did not load. Please redownload the latest build.";
        ModeBadge.ToolTip = e.ErrorException?.Message;
        Debug.WriteLine($"MAX pet image failed to load: {e.ErrorException}");
    }

    private void StartIdleAnimation()
    {
        var bob = new DoubleAnimation
        {
            From = 0,
            To = -5,
            Duration = TimeSpan.FromSeconds(1.55),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        PetFloat.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, bob);
    }

    private Forms.NotifyIcon CreateTrayIcon()
    {
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Show MAX", null, (_, _) => Dispatcher.InvokeAsync(ShowPet));

        var pauseItem = new Forms.ToolStripMenuItem("Pause microphone");
        pauseItem.CheckOnClick = true;
        pauseItem.Click += (_, _) =>
        {
            _voiceAssistant?.SetPaused(pauseItem.Checked);
            if (_voiceAssistant is null)
                SetVisualState("OFFLINE", "Windows speech is not ready.");
        };
        menu.Items.Add(pauseItem);
        menu.Items.Add("Microphone settings", null, (_, _) => OpenWindowsSettings("ms-settings:privacy-microphone"));
        menu.Items.Add("Speech settings", null, (_, _) => OpenWindowsSettings("ms-settings:speech"));

        var startupItem = new Forms.ToolStripMenuItem("Start MAX with Windows")
        {
            CheckOnClick = true,
            Checked = IsRegisteredForStartup()
        };
        startupItem.Click += (_, _) =>
        {
            try
            {
                SetStartupRegistration(startupItem.Checked);
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException)
            {
                startupItem.Checked = !startupItem.Checked;
                Forms.MessageBox.Show(
                    "MAX could not update the current-user startup setting.",
                    "MAX",
                    Forms.MessageBoxButtons.OK,
                    Forms.MessageBoxIcon.Warning);
                Debug.WriteLine(ex);
            }
        };
        menu.Items.Add(startupItem);

        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Exit MAX", null, (_, _) => ExitApplication());

        var icon = new Forms.NotifyIcon
        {
            Text = "MAX — desktop companion",
            Icon = System.Drawing.SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };
        icon.DoubleClick += (_, _) => Dispatcher.InvokeAsync(ShowPet);
        return icon;
    }

    private void VoiceAssistant_StatusChanged(string state)
    {
        var pieces = state.Split('|', 2);
        var mode = pieces.Length > 0 ? pieces[0] : "SLEEPING";
        var text = pieces.Length > 1 ? pieces[1] : "Sleeping · say “Max”";

        Dispatcher.InvokeAsync(() =>
        {
            ModeBadge.Text = mode;
            ModeBadge.Foreground = mode switch
            {
                "LISTENING" => System.Windows.Media.Brushes.DarkGreen,
                "SPEAKING" => System.Windows.Media.Brushes.DarkBlue,
                "PAUSED" or "OFFLINE" => System.Windows.Media.Brushes.DarkRed,
                _ => new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(68, 117, 68))
            };
            MicLight.Background = mode switch
            {
                "PAUSED" or "OFFLINE" => System.Windows.Media.Brushes.IndianRed,
                "SPEAKING" => System.Windows.Media.Brushes.DodgerBlue,
                "LISTENING" => System.Windows.Media.Brushes.OrangeRed,
                _ => System.Windows.Media.Brushes.ForestGreen
            };
            MicLight.ToolTip = mode switch
            {
                "PAUSED" => "Microphone is paused.",
                "OFFLINE" => "Speech recognition is not running. Check Windows speech and microphone settings.",
                "LISTENING" => "MAX is listening to your request.",
                "SPEAKING" => "MAX is speaking; microphone recognition is paused to avoid hearing itself.",
                _ => "Microphone is active for the local wake phrase “Max”."
            };

            if (mode is "SLEEPING" or "PAUSED" or "OFFLINE" ||
                (mode == "LISTENING" && StatusText.Text.StartsWith("Sleeping", StringComparison.Ordinal)))
            {
                StatusText.Text = text;
            }

            SleepIndicator.Visibility = mode == "SLEEPING" ? Visibility.Visible : Visibility.Collapsed;
            PetImage.Opacity = mode == "OFFLINE" ? 0.78 : 1.0;
        });
    }

    private void VoiceAssistant_Heard(string text)
    {
        Dispatcher.InvokeAsync(() =>
        {
            var clipped = text.Length > 78 ? text[..75] + "…" : text;
            StatusText.Text = "I heard: " + clipped;
        });
    }

    private void VoiceAssistant_Replied(string text)
    {
        Dispatcher.InvokeAsync(() =>
        {
            StatusText.Text = text.Length > 115 ? text[..112] + "…" : text;
        });
    }

    private void VoiceAssistant_MicrophoneLevelChanged(int level)
    {
        Dispatcher.InvokeAsync(() => MicLight.Opacity = level > 4 ? 1.0 : 0.55);
    }

    private void SetVisualState(string mode, string message)
    {
        ModeBadge.Text = mode;
        StatusText.Text = message;
        MicLight.Background = System.Windows.Media.Brushes.IndianRed;
        MicLight.ToolTip = "Speech recognition is not running. Check Windows speech and microphone settings.";
        SleepIndicator.Visibility = Visibility.Collapsed;
        PetImage.Opacity = 0.78;
    }

    private void Root_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed)
            return;

        try { DragMove(); }
        catch (InvalidOperationException) { }
    }

    private static void OpenWindowsSettings(string page)
    {
        try
        {
            Process.Start(new ProcessStartInfo(page) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Could not open Windows settings page {page}: {ex.Message}");
        }
    }

    private void ShowPet()
    {
        if (!IsVisible)
            Show();
        WindowState = WindowState.Normal;
        Topmost = true;
        Activate();
    }

    private bool IsRegisteredForStartup()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunRegistryPath, writable: false);
        return key?.GetValue(RunValueName) is string;
    }

    private void SetStartupRegistration(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunRegistryPath, writable: true);
        if (key is null)
            throw new UnauthorizedAccessException("Could not open the current-user startup registry key.");

        if (enabled)
        {
            var executable = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executable))
                throw new InvalidOperationException("Could not locate the MAX executable.");
            key.SetValue(RunValueName, $"\"{executable}\"");
        }
        else
        {
            key.DeleteValue(RunValueName, throwOnMissingValue: false);
        }
    }

    private void MainWindow_Closing(object? sender, CancelEventArgs e)
    {
        if (!_exitRequested)
        {
            e.Cancel = true;
            Hide();
            return;
        }

        _voiceAssistant?.Dispose();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
    }

    private void ExitApplication()
    {
        _exitRequested = true;
        Close();
    }
}
