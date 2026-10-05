using System;
using System.Linq;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text.RegularExpressions;
using System.Threading;

namespace MAX.Desktop.Assistant;

/// <summary>
/// Voice-only front end using Windows' installed desktop speech engine and voice.
/// MAX listens for the wake word and a small direct-command grammar while asleep,
/// then enables direct commands and dictation for the active conversation. Audio is not saved.
/// </summary>
public sealed class WindowsVoiceAssistant : IDisposable
{
    private const string WakeGrammarName = "MAX wake word";
    private const string WakeCommandGrammarName = "MAX wake and command";
    private const string CommandGrammarName = "MAX commands";
    private const string DictationGrammarName = "MAX dictation";
    private static readonly TimeSpan ActiveSilenceTimeout = TimeSpan.FromSeconds(40);
    private static readonly TimeSpan DuplicateRecognitionWindow = TimeSpan.FromSeconds(2);

    private readonly SpeechRecognitionEngine _recognizer;
    private readonly SpeechSynthesizer _speaker;
    private readonly Grammar _wakeGrammar;
    private readonly Grammar _wakeCommandGrammar;
    private readonly Grammar _commandGrammar;
    private readonly DictationGrammar _dictationGrammar;
    private readonly CommandRouter _commands;
    private readonly Timer _sleepTimer;
    private readonly object _recognitionGate = new();
    private volatile bool _awake;
    private volatile bool _paused;
    private volatile bool _speaking;
    private volatile bool _sleepAfterSpeech;
    private bool _recognitionRunning;
    private volatile bool _disposed;
    private string _lastHandledText = string.Empty;
    private DateTime _lastHandledAtUtc = DateTime.MinValue;

    public event Action<string>? StatusChanged;
    public event Action<string>? Heard;
    public event Action<string>? Replied;
    public event Action<int>? MicrophoneLevelChanged;

    public bool IsPaused => _paused;
    public bool IsInConversation => _awake || _speaking;
    public bool CanSpeakIdle => !_disposed && !_paused && !_awake && !_speaking;

    public void PublishCurrentStatus() => RaiseState();

    /// <summary>Speak a short ambient line only while MAX is asleep and microphone input is enabled.</summary>
    public bool SpeakIdle(string text)
    {
        if (!CanSpeakIdle || string.IsNullOrWhiteSpace(text))
            return false;

        _sleepAfterSpeech = false;
        Say(text);
        return true;
    }

    public WindowsVoiceAssistant(CommandRouter commands)
    {
        _commands = commands;
        var recognizerInfo = FindWindowsRecognizer();
        _recognizer = new SpeechRecognitionEngine(recognizerInfo);

        var wakeBuilder = new GrammarBuilder(new Choices("Max", "Hey Max"))
        {
            Culture = recognizerInfo.Culture
        };
        _wakeGrammar = new Grammar(wakeBuilder)
        {
            Name = WakeGrammarName,
            Enabled = true
        };
        _wakeCommandGrammar = CreateCommandGrammar(recognizerInfo, true, WakeCommandGrammarName);
        _commandGrammar = CreateCommandGrammar(recognizerInfo, false, CommandGrammarName);
        _dictationGrammar = new DictationGrammar
        {
            Name = DictationGrammarName,
            Enabled = false
        };

        _speaker = new SpeechSynthesizer();
        try
        {
            _speaker.SelectVoiceByHints(VoiceGender.NotSet, VoiceAge.NotSet, 0, recognizerInfo.Culture);
        }
        catch (ArgumentException)
        {
            // Keep the Windows default voice if it has no voice for the recognition locale.
        }
        _speaker.SpeakCompleted += Speaker_SpeakCompleted;

        _recognizer.LoadGrammar(_wakeGrammar);
        _recognizer.LoadGrammar(_wakeCommandGrammar);
        _recognizer.LoadGrammar(_commandGrammar);
        _recognizer.LoadGrammar(_dictationGrammar);
        _recognizer.SpeechRecognized += Recognizer_SpeechRecognized;
        _recognizer.AudioLevelUpdated += Recognizer_AudioLevelUpdated;
        _recognizer.RecognizerUpdateReached += Recognizer_RecognizerUpdateReached;
        _recognizer.RecognizeCompleted += Recognizer_RecognizeCompleted;
        _recognizer.EndSilenceTimeout = TimeSpan.FromMilliseconds(1100);
        _recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1500);

        _sleepTimer = new Timer(_ => SleepFromTimer(), null, Timeout.Infinite, Timeout.Infinite);
        ApplyGrammarState();
        StartRecognition();
        RaiseState();
    }

    public void SetPaused(bool paused)
    {
        if (_disposed || _paused == paused)
            return;

        _paused = paused;
        var startFailed = false;
        if (paused)
        {
            _awake = false;
            _sleepAfterSpeech = false;
            _sleepTimer.Change(Timeout.Infinite, Timeout.Infinite);
            try { _speaker.SpeakAsyncCancelAll(); }
            catch (InvalidOperationException) { }

            bool recognitionRunning;
            lock (_recognitionGate)
                recognitionRunning = _recognitionRunning;

            if (recognitionRunning)
            {
                try { _recognizer.RecognizeAsyncCancel(); }
                catch (InvalidOperationException)
                {
                    try { _recognizer.SetInputToNull(); }
                    catch (InvalidOperationException) { }
                }
            }
            else
            {
                try { _recognizer.SetInputToNull(); }
                catch (InvalidOperationException) { }
            }
        }
        else
        {
            try
            {
                StartRecognition();
            }
            catch (Exception ex)
            {
                startFailed = true;
                StatusChanged?.Invoke($"OFFLINE|Windows could not start voice input: {ex.Message}");
            }
        }

        RequestGrammarRefresh();
        if (!startFailed)
            RaiseState();
    }

    private static Grammar CreateCommandGrammar(RecognizerInfo recognizerInfo, bool includeWakeWord, string grammarName)
    {
        var builder = new GrammarBuilder
        {
            Culture = recognizerInfo.Culture
        };

        if (includeWakeWord)
            builder.Append(new Choices("Max", "Hey Max"));

        builder.Append(new Choices("open", "launch", "start", "close", "quit"));
        builder.Append(new Choices(
            "browser", "the browser", "web browser", "internet browser", "default browser",
            "notepad", "calculator", "calc", "paint", "file explorer", "explorer",
            "chrome", "google chrome", "edge", "microsoft edge", "firefox",
            "vs code", "visual studio code", "spotify", "google", "youtube"));

        return new Grammar(builder)
        {
            Name = grammarName,
            Enabled = false
        };
    }

    private void StartRecognition()
    {
        lock (_recognitionGate)
        {
            if (_disposed || _paused || _recognitionRunning)
                return;

            _recognizer.SetInputToDefaultAudioDevice();
            _recognizer.RecognizeAsync(RecognizeMode.Multiple);
            _recognitionRunning = true;
        }
    }

    private void Recognizer_RecognizeCompleted(object? sender, RecognizeCompletedEventArgs e)
    {
        bool shouldRestart;
        lock (_recognitionGate)
        {
            _recognitionRunning = false;
            if (_disposed)
                return;

            shouldRestart = !_paused;
            if (!shouldRestart)
            {
                try { _recognizer.SetInputToNull(); }
                catch (InvalidOperationException) { }
            }
        }

        if (!shouldRestart)
            return;

        if (e.Error is not null)
        {
            StatusChanged?.Invoke($"OFFLINE|Windows speech recognition stopped: {e.Error.Message}");
            return;
        }

        try
        {
            StartRecognition();
        }
        catch (Exception ex)
        {
            StatusChanged?.Invoke($"OFFLINE|Windows could not restart voice input: {ex.Message}");
        }
    }

    private static RecognizerInfo FindWindowsRecognizer()
    {
        var installed = SpeechRecognitionEngine.InstalledRecognizers();
        var selected = installed
            .Where(r => r.Culture.TwoLetterISOLanguageName.Equals("en", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(r => r.Culture.Name.Equals("en-IN", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(r => r.Culture.Name.Equals("en-GB", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(r => r.Culture.Name.Equals("en-US", StringComparison.OrdinalIgnoreCase))
            .FirstOrDefault();

        return selected ?? throw new InvalidOperationException(
            "Windows has no desktop speech recognizer installed. Add an English speech language in Windows Settings, then restart MAX.");
    }

    private void Recognizer_AudioLevelUpdated(object? sender, AudioLevelUpdatedEventArgs e)
    {
        if (!_disposed && !_paused)
            MicrophoneLevelChanged?.Invoke(e.AudioLevel);
    }

    private void Recognizer_SpeechRecognized(object? sender, SpeechRecognizedEventArgs e)
    {
        if (_disposed || _paused || _speaking || e.Result is null)
            return;

        var grammarName = e.Result.Grammar.Name;
        if (grammarName == WakeCommandGrammarName)
        {
            if (_awake || e.Result.Confidence < 0.10f)
                return;

            _awake = true;
            _sleepTimer.Change(ActiveSilenceTimeout, Timeout.InfiniteTimeSpan);
            HandleUtterance(e.Result.Text, sleepAfterReply: true);
            return;
        }

        if (grammarName == WakeGrammarName)
        {
            if (_awake || e.Result.Confidence < 0.10f)
                return;

            _awake = true;
            _sleepTimer.Change(ActiveSilenceTimeout, Timeout.InfiniteTimeSpan);
            RequestGrammarRefresh();
            RaiseState();
            Say("Hey!");
            return;
        }

        if (!_awake || (grammarName != CommandGrammarName && grammarName != DictationGrammarName))
            return;

        HandleUtterance(e.Result.Text, sleepAfterReply: false);
    }

    private void HandleUtterance(string transcript, bool sleepAfterReply)
    {
        transcript = transcript.Trim();
        if (transcript.Length == 0 || WasJustHandled(transcript))
            return;

        _sleepTimer.Change(ActiveSilenceTimeout, Timeout.InfiniteTimeSpan);
        Heard?.Invoke(transcript);

        var reply = _commands.Handle(transcript);
        _sleepAfterSpeech = sleepAfterReply || reply.SleepAfter;
        Say(reply.Text);
    }

    private bool WasJustHandled(string transcript)
    {
        var normalized = Regex.Replace(transcript, @"\s+", " ").Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;
        if (normalized == _lastHandledText && now - _lastHandledAtUtc < DuplicateRecognitionWindow)
            return true;

        _lastHandledText = normalized;
        _lastHandledAtUtc = now;
        return false;
    }

    private void Say(string text)
    {
        if (_disposed || string.IsNullOrWhiteSpace(text))
            return;

        _speaking = true;
        Replied?.Invoke(text);
        RequestGrammarRefresh();
        RaiseState();

        try
        {
            _speaker.SpeakAsync(text);
        }
        catch (InvalidOperationException)
        {
            _speaking = false;
            RequestGrammarRefresh();
            RaiseState();
        }
    }

    private void Speaker_SpeakCompleted(object? sender, SpeakCompletedEventArgs e)
    {
        if (_disposed)
            return;

        _speaking = false;
        if (_sleepAfterSpeech)
        {
            _sleepAfterSpeech = false;
            _awake = false;
            _sleepTimer.Change(Timeout.Infinite, Timeout.Infinite);
        }

        RequestGrammarRefresh();
        RaiseState();
    }

    private void SleepFromTimer()
    {
        if (_disposed || !_awake || _paused)
            return;

        _awake = false;
        _sleepAfterSpeech = false;
        RequestGrammarRefresh();
        RaiseState();
    }

    private void RequestGrammarRefresh()
    {
        if (_disposed)
            return;

        try
        {
            // Apply grammar changes at a safe point in the recognizer's audio loop.
            _recognizer.RequestRecognizerUpdate();
        }
        catch (InvalidOperationException)
        {
            ApplyGrammarState();
        }
    }

    private void Recognizer_RecognizerUpdateReached(object? sender, RecognizerUpdateReachedEventArgs e) =>
        ApplyGrammarState();

    private void ApplyGrammarState()
    {
        if (_disposed)
            return;

        var enabled = !_paused && !_speaking;
        _wakeGrammar.Enabled = enabled && !_awake;
        _wakeCommandGrammar.Enabled = enabled && !_awake;
        _commandGrammar.Enabled = enabled && _awake;
        _dictationGrammar.Enabled = enabled && _awake;
    }

    private void RaiseState()
    {
        var mode = _paused
            ? "PAUSED"
            : _speaking
                ? "SPEAKING"
                : _awake
                    ? "LISTENING"
                    : "SLEEPING";
        var status = _paused
            ? "Microphone paused"
            : _awake
                ? (_speaking ? "MAX is replying" : "Listening · talk to MAX")
                : "Sleeping · say “Max”";

        StatusChanged?.Invoke(mode + "|" + status);
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        _sleepTimer.Dispose();

        try { _recognizer.SpeechRecognized -= Recognizer_SpeechRecognized; }
        catch (InvalidOperationException) { }
        try { _recognizer.AudioLevelUpdated -= Recognizer_AudioLevelUpdated; }
        catch (InvalidOperationException) { }
        try { _recognizer.RecognizerUpdateReached -= Recognizer_RecognizerUpdateReached; }
        catch (InvalidOperationException) { }
        try { _recognizer.RecognizeCompleted -= Recognizer_RecognizeCompleted; }
        catch (InvalidOperationException) { }
        try { _recognizer.RecognizeAsyncCancel(); }
        catch (InvalidOperationException) { }

        _speaker.SpeakCompleted -= Speaker_SpeakCompleted;
        try { _speaker.SpeakAsyncCancelAll(); }
        catch (InvalidOperationException) { }

        _recognizer.Dispose();
        _speaker.Dispose();
    }
}
