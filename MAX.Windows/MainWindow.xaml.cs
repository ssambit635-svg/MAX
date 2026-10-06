using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Win32;
using MAX.Desktop.Assistant;
using MAX.Desktop.Pet;
using Forms = System.Windows.Forms;

namespace MAX.Desktop;

public partial class MainWindow : Window
{
    private const string RunRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "MAXCompanion";
    private const int WmNcHitTest = 0x0084;
    private const int HtClient = 1;
    private const int HtTransparent = -1;
    private const double CompactWidth = 320;
    private const double CompactHeight = 70;
    private const double ExpandedWidth = 660;
    private const double ExpandedHeight = 300;
    private const int MaxDroppedFileBytes = 250 * 1024 * 1024;

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
    private readonly DispatcherTimer _idleRemarkTimer = new();
    private readonly DispatcherTimer _hoverExpandTimer = new();
    private readonly DispatcherTimer _autoCollapseTimer = new();
    private readonly DispatcherTimer _messageTimer = new();
    private MediaPlayer? _whistlePlayer;
    private HwndSource? _windowSource;
    private bool _exitRequested;
    private bool _expanded;
    private string? _selectedFilePath;

    public MainWindow()
    {
        InitializeComponent();
        PositionIsland(CompactWidth);
        SetIslandMode(expanded: false, animated: false);
        StartTimers();

        _trayIcon = CreateTrayIcon();

        WindowsVoiceAssistant? assistant = null;
        try
        {
            assistant = new WindowsVoiceAssistant(new CommandRouter());
            assistant.StatusChanged += VoiceAssistant_StatusChanged;
            assistant.Heard += VoiceAssistant_Heard;
            assistant.Replied += VoiceAssistant_Replied;
            assistant.MicrophoneLevelChanged += VoiceAssistant_MicrophoneLevelChanged;
            assistant.PublishCurrentStatus();
        }
        catch (Exception ex)
        {
            SetVisualState("OFFLINE", "Speech isn't ready. Check Windows Speech and Microphone settings.");
            MicLight.Fill = Brushes.IndianRed;
            MicLight.ToolTip = ex.Message;
            Debug.WriteLine($"MAX voice startup failed: {ex}");
        }

        _voiceAssistant = assistant;
        Closing += MainWindow_Closing;
    }

    private void Window_SourceInitialized(object? sender, EventArgs e)
    {
        _windowSource = PresentationSource.FromVisual(this) as HwndSource;
        _windowSource?.AddHook(WindowProc);
    }

    /// <summary>
    /// The transparent space around the island is click-through, while the
    /// visible pill and expanded card remain interactive. This keeps MAX from
    /// stealing clicks across the desktop like a full-screen transparent window.
    /// </summary>
    private IntPtr WindowProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message != WmNcHitTest || !IsVisible)
            return IntPtr.Zero;

        var raw = lParam.ToInt64();
        var screenPoint = new Point((short)(raw & 0xFFFF), (short)((raw >> 16) & 0xFFFF));
        try
        {
            var local = PointFromScreen(screenPoint);
            if (IsPointInsideIsland(local))
                return new IntPtr(HtClient);

            handled = true;
            return new IntPtr(HtTransparent);
        }
        catch (InvalidOperationException)
        {
            return IntPtr.Zero;
        }
    }

    private bool IsPointInsideIsland(Point point)
    {
        var compactLeft = (Width - IslandSurface.Width) / 2;
        var compactRect = new Rect(compactLeft, 0, IslandSurface.Width, IslandSurface.Height);
        if (compactRect.Contains(point))
            return true;

        if (!_expanded)
            return false;

        var expandedLeft = (Width - ExpandedPanel.Width) / 2;
        var expandedRect = new Rect(expandedLeft, ExpandedPanel.Margin.Top, ExpandedPanel.Width, ExpandedPanel.Height);
        return expandedRect.Contains(point);
    }

    private void StartTimers()
    {
        _idleRemarkTimer.Tick += IdleRemarkTimer_Tick;
        _hoverExpandTimer.Tick += HoverExpandTimer_Tick;
        _autoCollapseTimer.Tick += AutoCollapseTimer_Tick;
        _messageTimer.Tick += MessageTimer_Tick;
        ScheduleNextIdleRemark();
        _hoverExpandTimer.Interval = TimeSpan.FromMilliseconds(220);
    }

    private void ScheduleNextIdleRemark()
    {
        _idleRemarkTimer.Stop();
        _idleRemarkTimer.Interval = TimeSpan.FromSeconds(Random.Shared.Next(120, 301));
        _idleRemarkTimer.Start();
    }

    private void IdleRemarkTimer_Tick(object? sender, EventArgs e)
    {
        ScheduleNextIdleRemark();
        if (_voiceAssistant?.CanSpeakIdle != true)
            return;

        if (Random.Shared.Next(3) == 0)
        {
            ShowIsland(expand: false);
            PlayIdleWhistle();
            return;
        }

        var remark = IdleRemarks[Random.Shared.Next(IdleRemarks.Length)];
        _voiceAssistant.SpeakIdle(remark);
    }

    private void HoverExpandTimer_Tick(object? sender, EventArgs e)
    {
        _hoverExpandTimer.Stop();
        if (!_expanded)
            SetIslandMode(expanded: true, animated: true);
    }

    private void AutoCollapseTimer_Tick(object? sender, EventArgs e)
    {
        _autoCollapseTimer.Stop();
        if (_voiceAssistant?.IsInConversation == true || _messageTimer.IsEnabled)
            return;

        SetIslandMode(expanded: false, animated: true);
    }

    private void MessageTimer_Tick(object? sender, EventArgs e)
    {
        _messageTimer.Stop();
        if (_voiceAssistant?.IsInConversation != true)
            SetIslandMode(expanded: false, animated: true);
    }

    private void ShowIsland(bool expand)
    {
        SetIslandMode(expand, animated: true);
    }

    private void SetIslandMode(bool expanded, bool animated)
    {
        _expanded = expanded;
        ExpandedPanel.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
        ExpandButton.Content = expanded ? "−" : "＋";
        ExpandButton.ToolTip = expanded ? "Collapse MAX island" : "Open MAX island";

        var targetWidth = expanded ? ExpandedWidth : CompactWidth;
        var targetHeight = expanded ? ExpandedHeight : CompactHeight;
        var area = SystemParameters.WorkArea;
        var targetLeft = area.Left + (area.Width - targetWidth) / 2;

        if (!IsVisible && IsLoaded)
            Show();
        Topmost = true;

        if (!animated)
        {
            StopWindowAnimations();
            Width = targetWidth;
            Height = targetHeight;
            Left = targetLeft;
            Top = area.Top + 4;
            IslandSurface.Width = expanded ? 620 : 300;
            ExpandedTitle.Text = expanded ? "MAX is here" : "MAX";
            return;
        }

        IslandSurface.Width = expanded ? 620 : 300;
        ExpandedTitle.Text = expanded ? "MAX is here" : "MAX";
        AnimateWindowTo(targetWidth, targetHeight, targetLeft);
    }

    private void AnimateWindowTo(double targetWidth, double targetHeight, double targetLeft)
    {
        StopWindowAnimations();
        var remaining = 3;
        void CompleteOne(object? sender, EventArgs args)
        {
            remaining--;
            if (remaining > 0)
                return;

            BeginAnimation(WidthProperty, null);
            BeginAnimation(HeightProperty, null);
            BeginAnimation(LeftProperty, null);
            Width = targetWidth;
            Height = targetHeight;
            Left = targetLeft;
        }

        var duration = new Duration(TimeSpan.FromMilliseconds(360));
        var easing = new CubicEase { EasingMode = EasingMode.EaseOut };
        var width = new DoubleAnimation(targetWidth, duration) { EasingFunction = easing };
        var height = new DoubleAnimation(targetHeight, duration) { EasingFunction = easing };
        var left = new DoubleAnimation(targetLeft, duration) { EasingFunction = easing };
        width.Completed += CompleteOne;
        height.Completed += CompleteOne;
        left.Completed += CompleteOne;
        BeginAnimation(WidthProperty, width, HandoffBehavior.SnapshotAndReplace);
        BeginAnimation(HeightProperty, height, HandoffBehavior.SnapshotAndReplace);
        BeginAnimation(LeftProperty, left, HandoffBehavior.SnapshotAndReplace);
    }

    private void StopWindowAnimations()
    {
        var currentWidth = Width;
        var currentHeight = Height;
        var currentLeft = Left;
        BeginAnimation(WidthProperty, null);
        BeginAnimation(HeightProperty, null);
        BeginAnimation(LeftProperty, null);
        Width = currentWidth;
        Height = currentHeight;
        Left = currentLeft;
    }

    private void PositionIsland(double width)
    {
        var area = SystemParameters.WorkArea;
        Left = area.Left + (area.Width - width) / 2;
        Top = area.Top + 4;
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
                Path.Combine(AppContext.BaseDirectory, "Assets", "max-whistle.wav"),
                UriKind.Absolute));
            _whistlePlayer.Play();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"MAX's idle whistle could not play: {ex.Message}");
            _voiceAssistant?.SpeakIdle("Doo-doo-doo!");
        }
    }

    private Forms.NotifyIcon CreateTrayIcon()
    {
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Open MAX island", null, (_, _) => Dispatcher.InvokeAsync(() => SetIslandMode(true, true)));

        var pauseItem = new Forms.ToolStripMenuItem("Pause microphone")
        {
            CheckOnClick = true
        };
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
            Text = "MAX — animated desktop companion",
            Icon = System.Drawing.SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };
        icon.DoubleClick += (_, _) => Dispatcher.InvokeAsync(() => SetIslandMode(true, true));
        return icon;
    }

    private void VoiceAssistant_StatusChanged(string state)
    {
        var pieces = state.Split('|', 2);
        var mode = pieces.Length > 0 ? pieces[0] : "SLEEPING";
        var text = pieces.Length > 1 ? pieces[1] : "Sleeping · say Max";

        Dispatcher.InvokeAsync(() =>
        {
            ApplyAssistantState(mode, text);
        });
    }

    private void ApplyAssistantState(string mode, string text)
    {
        var mood = mode switch
        {
            "LISTENING" => MaxPetMood.Listening,
            "SPEAKING" => MaxPetMood.Speaking,
            "OFFLINE" or "PAUSED" => MaxPetMood.Surprised,
            _ => MaxPetMood.Sleeping
        };
        CompactPet.Mood = mood;
        ExpandedPet.Mood = mood;
        IslandSubtitle.Text = Shorten(text, 42);
        ExpandedStatus.Text = text;

        MicLight.Fill = mode switch
        {
            "LISTENING" => Brushes.OrangeRed,
            "SPEAKING" => Brushes.DodgerBlue,
            "PAUSED" or "OFFLINE" => Brushes.IndianRed,
            _ => Brushes.ForestGreen
        };
        MicLight.ToolTip = mode switch
        {
            "PAUSED" => "Microphone is paused.",
            "OFFLINE" => "Speech isn't running. Check Windows Speech and Microphone settings.",
            "LISTENING" => "MAX is listening to your request.",
            "SPEAKING" => "MAX is speaking.",
            _ => "MAX is listening for “Max”."
        };

        if (mode is "PAUSED" or "OFFLINE" or "LISTENING" or "SPEAKING")
        {
            if (mode is "PAUSED" or "OFFLINE")
                ShowSpeechBubble(text, 7000);
            else
                SetIslandMode(true, animated: true);
        }
        else if (!_messageTimer.IsEnabled && !(_voiceAssistant?.IsInConversation ?? false))
        {
            SetIslandMode(false, animated: true);
        }
    }

    private void VoiceAssistant_Heard(string text)
    {
        Dispatcher.InvokeAsync(() =>
        {
            SetIslandMode(true, animated: true);
            CompactPet.Mood = MaxPetMood.Listening;
            ExpandedPet.Mood = MaxPetMood.Listening;
            var clipped = text.Length > 35 ? text[..32] + "…" : text;
            IslandSubtitle.Text = "I heard: " + clipped;
            ExpandedStatus.Text = "I heard: " + text;
            ScheduleMessageCollapse(5500);
        });
    }

    private void VoiceAssistant_Replied(string text)
    {
        Dispatcher.InvokeAsync(() =>
        {
            SetIslandMode(true, animated: true);
            CompactPet.Mood = MaxPetMood.Happy;
            ExpandedPet.Mood = MaxPetMood.Happy;
            IslandSubtitle.Text = Shorten(text, 42);
            ExpandedStatus.Text = text;
            ScheduleMessageCollapse(6000);
        });
    }

    private void VoiceAssistant_MicrophoneLevelChanged(int level)
    {
        Dispatcher.InvokeAsync(() => MicLight.Opacity = level > 4 ? 1.0 : 0.55);
    }

    private void SetVisualState(string mode, string message)
    {
        Dispatcher.InvokeAsync(() => ApplyAssistantState(mode, message));
    }

    private void ScheduleMessageCollapse(int milliseconds)
    {
        _messageTimer.Stop();
        _messageTimer.Interval = TimeSpan.FromMilliseconds(milliseconds);
        _messageTimer.Start();
    }

    private void ShowSpeechBubble(string text, int durationMilliseconds = 5000)
    {
        if (string.IsNullOrWhiteSpace(text))
            return;

        IslandSubtitle.Text = Shorten(text.Trim(), 42);
        ExpandedStatus.Text = text.Trim();
        SetIslandMode(true, animated: true);
        ScheduleMessageCollapse(durationMilliseconds);
    }

    private void IslandSurface_MouseEnter(object sender, MouseEventArgs e)
    {
        if (!_expanded)
            _hoverExpandTimer.Start();
    }

    private void IslandSurface_MouseLeave(object sender, MouseEventArgs e)
    {
        _hoverExpandTimer.Stop();
        if (_expanded)
            ScheduleAutoCollapse();
    }

    private void ExpandedPanel_MouseEnter(object sender, MouseEventArgs e)
    {
        _autoCollapseTimer.Stop();
    }

    private void ExpandedPanel_MouseLeave(object sender, MouseEventArgs e)
    {
        ScheduleAutoCollapse();
    }

    private void ScheduleAutoCollapse()
    {
        _autoCollapseTimer.Stop();
        _autoCollapseTimer.Interval = TimeSpan.FromSeconds(12);
        _autoCollapseTimer.Start();
    }

    private void IslandSurface_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is Button)
            return;

        SetIslandMode(!_expanded, animated: true);
        e.Handled = true;
    }

    private void MaxPet_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        SetIslandMode(!_expanded, animated: true);
        e.Handled = true;
    }

    private void ToggleIslandButton_Click(object sender, RoutedEventArgs e)
    {
        SetIslandMode(!_expanded, animated: true);
    }

    private void CollapseIslandButton_Click(object sender, RoutedEventArgs e)
    {
        SetIslandMode(false, animated: true);
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

    private void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        OpenWindowsSettings("ms-settings:speech");
    }

    private void FileDropSurface_DragOver(object sender, DragEventArgs e)
    {
        var valid = e.Data.GetDataPresent(DataFormats.FileDrop);
        e.Effects = valid ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
        if (valid)
            FileDropText.Text = "Release to give MAX a local file reference.";
    }

    private void FileDropSurface_Drop(object sender, DragEventArgs e)
    {
        e.Handled = true;
        if (!e.Data.GetDataPresent(DataFormats.FileDrop))
            return;

        var paths = e.Data.GetData(DataFormats.FileDrop) as string[];
        var path = paths?.FirstOrDefault(File.Exists);
        if (string.IsNullOrWhiteSpace(path))
        {
            FileDropText.Text = "Folders are not accepted yet. Drop one file at a time.";
            return;
        }

        try
        {
            var info = new FileInfo(path);
            if (info.Length > MaxDroppedFileBytes)
            {
                FileDropText.Text = "That file is larger than the 250 MB local limit.";
                return;
            }

            _selectedFilePath = info.FullName;
            FileDropText.Text = $"Ready locally: {info.Name} · {FormatBytes(info.Length)}. Nothing was uploaded.";
            ExpandedStatus.Text = "MAX has a local file reference ready.";
            ExpandedPet.Mood = MaxPetMood.Happy;
            ScheduleMessageCollapse(7000);
        }
        catch (IOException ex)
        {
            FileDropText.Text = $"MAX could not inspect that file: {ex.Message}";
        }
        catch (UnauthorizedAccessException)
        {
            FileDropText.Text = "MAX does not have permission to inspect that file.";
        }
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024)
            return $"{bytes} B";
        if (bytes < 1024 * 1024)
            return $"{bytes / 1024d:0.0} KB";
        if (bytes < 1024 * 1024 * 1024)
            return $"{bytes / (1024d * 1024d):0.0} MB";
        return $"{bytes / (1024d * 1024d * 1024d):0.0} GB";
    }

    private static string Shorten(string text, int length)
    {
        return text.Length > length ? text[..(length - 1)] + "…" : text;
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

        _idleRemarkTimer.Stop();
        _hoverExpandTimer.Stop();
        _autoCollapseTimer.Stop();
        _messageTimer.Stop();
        _voiceAssistant?.Dispose();
        _whistlePlayer?.Stop();
        _whistlePlayer?.Close();
        _windowSource?.RemoveHook(WindowProc);
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
    }

    private void ExitApplication()
    {
        _exitRequested = true;
        Close();
    }
}
