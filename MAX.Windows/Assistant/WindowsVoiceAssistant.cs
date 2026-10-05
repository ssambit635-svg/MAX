using System;
using System.Linq;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Threading;

namespace MAX.Desktop.Assistant;

/// <summary>
/// Voice-only front end using Windows' installed desktop speech engine and voice.
/// MAX listens for the small wake-word grammar while asleep, then enables dictation
/// for the active conversation. Audio is not saved by this class or sent to a server.
/// </summary>
public sealed class WindowsVoiceAssistant : IDisposable
{
    private const string WakeGrammarName = "MAX wake word";
    private const string DictationGrammarName = "MAX dictation";
    private static readonly TimeSpan ActiveSilenceTimeout = TimeSpan.FromSeconds(40);

    private readonly SpeechRecognitionEngine _recognizer;
    private readonly SpeechSynthesizer _speaker;
    private readonly Grammar _wakeGrammar;
    private readonly DictationGrammar _dictationGrammar;
    private readonly CommandRouter _commands;
    private readonly Timer _sleepTimer;
    private volatile bool _awake;
    private volatile bool _paused;
    private volatile bool _speaking;
    private volatile bool _sleepAfterSpeech;
    private bool _disposed;

    public event Action<string>? StatusChanged;
    public event Action<string>? Heard;
    public event Action<string>? Replied;

    public bool IsPaused => _paused;

    public WindowsVoiceAssistant(CommandRouter commands)
    {
        _commands = commands;
        var recognizerInfo = FindWindowsRecognizer();
        _recognizer = new SpeechRecognitionEngine(recognizerInfo);

        var wakeBuilder = new GrammarBuilder(new Choices("Max"))
        {
            Culture = recognizerInfo.Culture
        };
        _wakeGrammar = new Grammar(wakeBuilder)
        {
            Name = WakeGrammarName,
            Enabled = true
        };
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
        _recognizer.LoadGrammar(_dictationGrammar);
        _recognizer.SpeechRecognized += Recognizer_SpeechRecognized;
        _recognizer.RecognizerUpdateReached += Recognizer_RecognizerUpdateReached;
        _recognizer.EndSilenceTimeout = TimeSpan.FromMilliseconds(850);
        _recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1200);
        _recognizer.SetInputToDefaultAudioDevice();

        _sleepTimer = new Timer(_ => SleepFromTimer(), null, Timeout.Infinite, Timeout.Infinite);
        _recognizer.RecognizeAsync(RecognizeMode.Multiple);
        RaiseState();
    }

    public void SetPaused(bool paused)
    {
        if (_disposed)
            return;

        _paused = paused;
        if (paused)
        {
            _awake = false;
            _sleepAfterSpeech = false;
            _sleepTimer.Change(Timeout.Infinite, Timeout.Infinite);
            try { _speaker.SpeakAsyncCancelAll(); }
            catch (InvalidOperationException) { }
        }

        RequestGrammarRefresh();
        RaiseState();
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

    private void Recognizer_SpeechRecognized(object? sender, SpeechRecognizedEventArgs e)
    {
        if (_disposed || _paused || _speaking || e.Result is null)
            return;

        if (e.Result.Grammar.Name == WakeGrammarName)
        {
            if (_awake || e.Result.Confidence < 0.48f)
                return;

            _awake = true;
            _sleepTimer.Change(ActiveSilenceTimeout, Timeout.InfiniteTimeSpan);
            RequestGrammarRefresh();
            RaiseState();
            Say("I'm here. What would you like to do?");
            return;
        }

        if (!_awake || e.Result.Grammar.Name != DictationGrammarName || e.Result.Confidence < 0.38f)
            return;

        var transcript = e.Result.Text.Trim();
        if (transcript.Length == 0)
            return;

        _sleepTimer.Change(ActiveSilenceTimeout, Timeout.InfiniteTimeSpan);
        Heard?.Invoke(transcript);

        var reply = _commands.Handle(transcript);
        _sleepAfterSpeech = reply.SleepAfter;
        Say(reply.Text);
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
        try { _recognizer.RecognizerUpdateReached -= Recognizer_RecognizerUpdateReached; }
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
