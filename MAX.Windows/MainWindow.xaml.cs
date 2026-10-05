using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
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
    private static readonly string[] IdleRemarks =
    {
        "Doo-doo-doo! This is a nice little wander.",
        "I'm having a tiny stroll.",
        "I wonder what's over there.",
        "Just stretching my little legs.",
        "I'm still here if you need me.",
        "This spot looks nice for a moment."
    };

    private readonly WindowsVoiceAssistant? _voiceAssistant;
    private readonly Forms.NotifyIcon _trayIcon;
    private readonly DispatcherTimer _wanderTimer = new();
    private readonly DispatcherTimer _idleRemarkTimer = new();
    private readonly DispatcherTimer _reappearTimer = new();
    private readonly DispatcherTimer _bubbleTimer = new();
    private readonly Random _random = new();
    private MediaPlayer? _whistlePlayer;
    private bool _exitRequested;
    private bool _temporarilyHidden;
    private bool _isDragging;
    private int _quickTapCount;
    private DateTime _lastTapAtUtc = DateTime.MinValue;

    public MainWindow()
    {
        InitializeComponent();
        MovePetToRandomSpot(animated: false);
        StartIdleAnimation();
        StartPetTimers();

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
            SetVisualState("OFFLINE", "Speech isn't ready. Check Windows Speech and Microphone settings.");
            MicLight.Background = System.Windows.Media.Brushes.IndianRed;
            MicLight.ToolTip = ex.Message;
            Debug.WriteLine($"MAX voice startup failed: {ex}");
        }

        Closing += MainWindow_Closing;
    }

    private void PetImage_ImageFailed(object sender, System.Windows.ExceptionRoutedEventArgs e)
    {
        PetImage.Visibility = Visibility.Collapsed;
        PetFallback.Visibility = Visibility.Visible;
        ShowSpeechBubble("MAX's picture didn't load.", 7000);
        Debug.WriteLine($"MAX reference picture failed to load: {e.ErrorException}");
    }

    private void StartIdleAnimation()
    {
        var bob = new DoubleAnimation
        {
            From = 0,
            To = -3.5,
            Duration = TimeSpan.FromSeconds(1.4),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
        };
        PetBob.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, bob);
    }

    private void StartPetTimers()
    {
        _wanderTimer.Tick += WanderTimer_Tick;
        _idleRemarkTimer.Tick += IdleRemarkTimer_Tick;
        _reappearTimer.Tick += ReappearTimer_Tick;
        _bubbleTimer.Tick += BubbleTimer_Tick;
        ScheduleNextWander();
        ScheduleNextIdleRemark();
    }

    private void ScheduleNextWander()
    {
        _wanderTimer.Stop();
        _wanderTimer.Interval = TimeSpan.FromSeconds(_random.Next(22, 46));
        _wanderTimer.Start();
    }

    private void ScheduleNextIdleRemark()
    {
        _idleRemarkTimer.Stop();
        _idleRemarkTimer.Interval = TimeSpan.FromSeconds(_random.Next(120, 301));
        _idleRemarkTimer.Start();
    }

    private void WanderTimer_Tick(object? sender, EventArgs e)
    {
        if (_temporarilyHidden || _isDragging || _voiceAssistant?.IsInConversation == true)
        {
            ScheduleNextWander();
            return;
        }

        if (_random.Next(5) == 0)
            HidePetTemporarily();
        else
            MovePetToRandomSpot(animated: true);

        ScheduleNextWander();
    }

    private void IdleRemarkTimer_Tick(object? sender, EventArgs e)
    {
        ScheduleNextIdleRemark();
        if (_voiceAssistant?.CanSpeakIdle != true)
            return;

        ShowPet();
        if (_random.Next(3) == 0)
        {
            PlayIdleWhistle();
            return;
        }

        var remark = IdleRemarks[_random.Next(IdleRemarks.Length)];
        _voiceAssistant.SpeakIdle(remark);
    }

    private void PlayIdleWhistle()
    {
        try
        {
            if (_whistlePlayer is null)
            {
                _whistlePlayer = new MediaPlayer { Volume = 0.25 };
                _whistlePlayer.MediaFailed += (_, args) =>
                {
                    Debug.WriteLine($"MAX's idle whistle could not play: {args.ErrorException?.Message ?? "unknown media error"}");
                    Dispatcher.InvokeAsync(() => _voiceAssistant?.SpeakIdle("Doo-doo-doo!"));
                };
            }
            _whistlePlayer.Stop();
            _whistlePlayer.Open(new Uri(
                System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "max-whistle.wav"),
                UriKind.Absolute));
            _whistlePlayer.Play();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"MAX's idle whistle could not play: {ex.Message}");
            _voiceAssistant?.SpeakIdle("Doo-doo-doo!");
        }
    }

    private void MovePetToRandomSpot(bool animated)
    {
        var area = SystemParameters.WorkArea;
        var minLeft = area.Left + 8;
        var maxLeft = Math.Max(minLeft, area.Right - Width - 8);
        var minTop = area.Top + 28;
        var maxTop = Math.Max(minTop, area.Bottom - Height - 12);
        var targetLeft = minLeft + _random.NextDouble() * (maxLeft - minLeft);
        var targetTop = minTop + _random.NextDouble() * (maxTop - minTop);

        if (!animated)
        {
            StopPositionAnimations();
            Left = targetLeft;
            Top = targetTop;
            return;
        }

        var duration = TimeSpan.FromSeconds(3.5 + _random.NextDouble() * 3.0);
        var easing = new QuadraticEase { EasingMode = EasingMode.EaseInOut };
        BeginAnimation(Window.LeftProperty, new DoubleAnimation
        {
            To = targetLeft,
            Duration = duration,
            EasingFunction = easing
        }, HandoffBehavior.SnapshotAndReplace);
        BeginAnimation(Window.TopProperty, new DoubleAnimation
        {
            To = targetTop,
            Duration = duration,
            EasingFunction = easing
        }, HandoffBehavior.SnapshotAndReplace);
    }

    private void StopPositionAnimations()
    {
        var currentLeft = Left;
        var currentTop = Top;
        BeginAnimation(Window.LeftProperty, null);
        BeginAnimation(Window.TopProperty, null);
        Left = currentLeft;
        Top = currentTop;
    }

    private void HidePetTemporarily()
    {
        if (_temporarilyHidden)
            return;

        StopPositionAnimations();
        _temporarilyHidden = true;
        Root.IsHitTestVisible = false;
        var fadeOut = new DoubleAnimation
        {
            To = 0,
            Duration = TimeSpan.FromMilliseconds(450),
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
        };
        fadeOut.Completed += (_, _) =>
        {
            if (_temporarilyHidden)
                Hide();
        };
        BeginAnimation(OpacityProperty, fadeOut, HandoffBehavior.SnapshotAndReplace);

        _reappearTimer.Interval = TimeSpan.FromSeconds(_random.Next(4, 11));
        _reappearTimer.Start();
    }

    private void ReappearTimer_Tick(object? sender, EventArgs e)
    {
        _reappearTimer.Stop();
        if (!_temporarilyHidden)
            return;

        _temporarilyHidden = false;
        MovePetToRandomSpot(animated: false);
        BeginAnimation(OpacityProperty, null);
        Opacity = 0;
        Root.IsHitTestVisible = true;
        if (!IsVisible)
            Show();
        Topmost = true;
        BeginAnimation(OpacityProperty, new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = TimeSpan.FromMilliseconds(550),
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
        }, HandoffBehavior.SnapshotAndReplace);
    }

    private void BubbleTimer_Tick(object? sender, EventArgs e)
    {
        _bubbleTimer.Stop();
        SpeechBubble.Visibility = Visibility.Collapsed;
    }

    private void ShowSpeechBubble(string text, int durationMilliseconds = 5000)
    {
        if (string.IsNullOrWhiteSpace(text))
            return;

        var trimmed = text.Trim();
        StatusText.Text = trimmed.Length > 44 ? trimmed[..41] + "…" : trimmed;
        SpeechBubble.Visibility = Visibility.Visible;
        _bubbleTimer.Stop();
        _bubbleTimer.Interval = TimeSpan.FromMilliseconds(durationMilliseconds);
        _bubbleTimer.Start();
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
        var text = pieces.Length > 1 ? pieces[1] : "Sleeping · say Max";

        Dispatcher.InvokeAsync(() =>
        {
            MicLight.Background = mode switch
            {
                "LISTENING" => System.Windows.Media.Brushes.OrangeRed,
                "SPEAKING" => System.Windows.Media.Brushes.DodgerBlue,
                "PAUSED" or "OFFLINE" => System.Windows.Media.Brushes.IndianRed,
                _ => System.Windows.Media.Brushes.ForestGreen
            };
            MicLight.ToolTip = mode switch
            {
                "PAUSED" => "Microphone is paused.",
                "OFFLINE" => "Speech isn't running. Check Windows Speech and Microphone settings.",
                "LISTENING" => "MAX is listening for your request.",
                "SPEAKING" => "MAX is speaking.",
                _ => "MAX is listening for “Max”."
            };

            if (mode is "PAUSED" or "OFFLINE")
                ShowSpeechBubble(text, 7000);
            else if (mode == "LISTENING" && !_bubbleTimer.IsEnabled)
                ShowSpeechBubble("Listening...", 4000);

            PetImage.Opacity = mode == "OFFLINE" ? 0.78 : 1.0;
        });
    }

    private void VoiceAssistant_Heard(string text)
    {
        Dispatcher.InvokeAsync(() =>
        {
            ShowPet();
            var clipped = text.Length > 35 ? text[..32] + "…" : text;
            ShowSpeechBubble("I heard: " + clipped, 5500);
        });
    }

    private void VoiceAssistant_Replied(string text)
    {
        Dispatcher.InvokeAsync(() =>
        {
            ShowPet();
            ShowSpeechBubble(text, 6000);
        });
    }

    private void VoiceAssistant_MicrophoneLevelChanged(int level)
    {
        Dispatcher.InvokeAsync(() => MicLight.Opacity = level > 4 ? 1.0 : 0.55);
    }

    private void SetVisualState(string mode, string message)
    {
        MicLight.Background = mode == "OFFLINE"
            ? System.Windows.Media.Brushes.IndianRed
            : System.Windows.Media.Brushes.ForestGreen;
        MicLight.ToolTip = message;
        ShowSpeechBubble(message, 7000);
        PetImage.Opacity = mode == "OFFLINE" ? 0.78 : 1.0;
    }

    private void Root_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed)
            return;

        var pressPoint = Forms.Cursor.Position;
        StopPositionAnimations();
        _isDragging = true;
        try { DragMove(); }
        catch (InvalidOperationException) { }
        finally
        {
            _isDragging = false;
            ScheduleNextWander();

            var releasePoint = Forms.Cursor.Position;
            if (Math.Abs(releasePoint.X - pressPoint.X) < 5 && Math.Abs(releasePoint.Y - pressPoint.Y) < 5)
                PetTapped();
        }
    }

    private void PetTapped()
    {
        var now = DateTime.UtcNow;
        _quickTapCount = now - _lastTapAtUtc <= TimeSpan.FromMilliseconds(550)
            ? _quickTapCount + 1
            : 1;
        _lastTapAtUtc = now;

        if (_quickTapCount >= 3)
        {
            _quickTapCount = 0;
            SpinPet();
            ShowSpeechBubble("Wheee!", 1400);
            return;
        }

        SquishPet();
    }

    private void SquishPet()
    {
        var easing = new QuadraticEase { EasingMode = EasingMode.EaseOut };
        PetSquash.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation
        {
            From = 1,
            To = 0.78,
            Duration = TimeSpan.FromMilliseconds(110),
            AutoReverse = true,
            EasingFunction = easing
        }, HandoffBehavior.SnapshotAndReplace);
        PetSquash.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation
        {
            From = 1,
            To = 1.12,
            Duration = TimeSpan.FromMilliseconds(110),
            AutoReverse = true,
            EasingFunction = easing
        }, HandoffBehavior.SnapshotAndReplace);
    }

    private void SpinPet()
    {
        PetSpin.BeginAnimation(RotateTransform.AngleProperty, null);
        PetSpin.Angle = 0;
        var spin = new DoubleAnimation(0, 360, TimeSpan.FromMilliseconds(700))
        {
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
        };
        spin.Completed += (_, _) =>
        {
            PetSpin.BeginAnimation(RotateTransform.AngleProperty, null);
            PetSpin.Angle = 0;
        };
        PetSpin.BeginAnimation(RotateTransform.AngleProperty, spin, HandoffBehavior.SnapshotAndReplace);
        SquishPet();
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
        _reappearTimer.Stop();
        _temporarilyHidden = false;
        BeginAnimation(OpacityProperty, null);
        Opacity = 1;
        Root.IsHitTestVisible = true;
        if (!IsVisible)
            Show();
        Topmost = true;
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

        _wanderTimer.Stop();
        _idleRemarkTimer.Stop();
        _reappearTimer.Stop();
        _bubbleTimer.Stop();
        _voiceAssistant?.Dispose();
        _whistlePlayer?.Stop();
        _whistlePlayer?.Close();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
    }

    private void ExitApplication()
    {
        _exitRequested = true;
        Close();
    }
}
