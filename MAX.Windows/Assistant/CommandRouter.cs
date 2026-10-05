using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;

namespace MAX.Desktop.Assistant;

public sealed record AssistantReply(string Text, bool SleepAfter = false);

/// <summary>
/// A small, deterministic command brain for the first Windows build.
/// It has no LLM, cloud endpoint, API key, shell-command execution, or file access.
/// </summary>
public sealed class CommandRouter
{
    private sealed record AppDefinition(string DisplayName, string Executable, string ProcessName);

    private static readonly IReadOnlyDictionary<string, AppDefinition> Apps =
        new Dictionary<string, AppDefinition>(StringComparer.OrdinalIgnoreCase)
        {
            ["notepad"] = new("Notepad", "notepad.exe", "notepad"),
            ["calculator"] = new("Calculator", "calc.exe", "CalculatorApp"),
            ["calc"] = new("Calculator", "calc.exe", "CalculatorApp"),
            ["paint"] = new("Paint", "mspaint.exe", "mspaint"),
            ["file explorer"] = new("File Explorer", "explorer.exe", "explorer"),
            ["explorer"] = new("File Explorer", "explorer.exe", "explorer"),
            ["chrome"] = new("Google Chrome", "chrome.exe", "chrome"),
            ["google chrome"] = new("Google Chrome", "chrome.exe", "chrome"),
            ["edge"] = new("Microsoft Edge", "msedge.exe", "msedge"),
            ["microsoft edge"] = new("Microsoft Edge", "msedge.exe", "msedge"),
            ["firefox"] = new("Firefox", "firefox.exe", "firefox"),
            ["vs code"] = new("Visual Studio Code", "Code.exe", "Code"),
            ["visual studio code"] = new("Visual Studio Code", "Code.exe", "Code"),
            ["spotify"] = new("Spotify", "Spotify.exe", "Spotify")
        };

    public AssistantReply Handle(string recognizedText)
    {
        var text = Clean(recognizedText);
        if (text.Length == 0)
            return new AssistantReply("I didn't catch that. Try saying it once more.");

        text = Regex.Replace(text, @"^(?:hey\s+)?max[\s,.:;-]*", "", RegexOptions.IgnoreCase).Trim();
        if (text.Length == 0)
            return new AssistantReply("I'm here. What would you like me to do?");

        if (IsSleepCommand(text))
            return new AssistantReply("Okay. I'll go back to sleep. Say Max whenever you need me.", SleepAfter: true);

        if (TryGetSearch(text, out var searchTarget, out var query))
            return Search(searchTarget, query);

        if (TryGetAppCommand(text, "open", out var appToOpen) ||
            TryGetAppCommand(text, "launch", out appToOpen) ||
            TryGetAppCommand(text, "start", out appToOpen))
            return RunForSeveral(appToOpen, OpenApp);

        if (TryGetAppCommand(text, "close", out var appToClose) ||
            TryGetAppCommand(text, "quit", out appToClose))
            return RunForSeveral(appToClose, CloseApp);

        if (ContainsAny(text, "what time is it", "tell me the time", "current time"))
            return new AssistantReply($"It's {DateTime.Now:h:mm tt}.");

        if (ContainsAny(text, "how are you", "how are you doing"))
            return new AssistantReply("I'm happy you're here. I'm still learning, but I'm listening.");

        if (ContainsAny(text, "hello", "hi max", "hey max", "good morning", "good evening"))
            return new AssistantReply("Hey! Nice to hear your voice.");

        if (ContainsAny(text, "thank you", "thanks max", "thanks"))
            return new AssistantReply("Anytime. I'll be right here.");

        if (ContainsAny(text, "who are you", "what is your name", "your name"))
            return new AssistantReply("I'm MAX, your little desktop companion. Say Max when you want me.");

        if (ContainsAny(text, "what can you do", "help me", "help"))
            return new AssistantReply("I can open or politely close a few apps, search Google or YouTube in your browser, tell you the time, and keep you company. I'm still learning conversation.");

        return new AssistantReply("I heard you. I'm still learning open conversation. You can ask me to open or close an app, search Google or YouTube, or tell you the time.");
    }

    private static AssistantReply RunForSeveral(string spokenNames, Func<string, AssistantReply> action)
    {
        var names = Regex.Split(spokenNames, @"\s+(?:and|then)\s+", RegexOptions.IgnoreCase)
            .Select(name => name.Trim())
            .Where(name => name.Length > 0)
            .Take(4)
            .ToArray();

        if (names.Length <= 1)
            return action(spokenNames);

        var replies = names.Select(name => action(name).Text).ToArray();
        return new AssistantReply(string.Join(" ", replies));
    }

    private static AssistantReply Search(string target, string query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            var home = target == "youtube"
                ? "https://www.youtube.com/"
                : "https://www.google.com/";
            return OpenUrl(home, target == "youtube" ? "YouTube" : "Google");
        }

        var encoded = Uri.EscapeDataString(query.Trim());
        var url = target == "youtube"
            ? $"https://www.youtube.com/results?search_query={encoded}"
            : $"https://www.google.com/search?q={encoded}";
        var site = target == "youtube" ? "YouTube" : "Google";
        var result = OpenUrl(url, site);
        return result with { Text = $"Searching {site} for {query.Trim()} in your browser." };
    }

    private static AssistantReply OpenUrl(string url, string destination)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
            return new AssistantReply($"Opening {destination} in your default browser.");
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return new AssistantReply("I couldn't open your browser. Please check that a default browser is set in Windows.");
        }
    }

    private static AssistantReply OpenApp(string spokenName)
    {
        var name = NormalizeAppName(spokenName);
        if (name is "youtube" or "google")
            return OpenUrl(name == "youtube" ? "https://www.youtube.com/" : "https://www.google.com/", name == "youtube" ? "YouTube" : "your browser");

        if (name is "browser" or "the browser" or "web browser" or "internet" or "internet browser" or "default browser")
            return OpenUrl("https://www.google.com/", "your browser");

        if (!Apps.TryGetValue(name, out var app))
            return new AssistantReply($"I don't have an app shortcut for {spokenName} yet. Try Notepad, Calculator, Paint, Chrome, Edge, Firefox, Visual Studio Code, or Spotify.");

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = app.Executable,
                UseShellExecute = true
            });
            return new AssistantReply($"Opening {app.DisplayName}.");
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or System.IO.FileNotFoundException)
        {
            return new AssistantReply($"I couldn't find {app.DisplayName} on this PC.");
        }
    }

    private static AssistantReply CloseApp(string spokenName)
    {
        var name = NormalizeAppName(spokenName);
        if (name is "file explorer" or "explorer" or "windows explorer")
            return new AssistantReply("I won't close Windows Explorer because it also hosts parts of the desktop.");

        if (!Apps.TryGetValue(name, out var app))
            return new AssistantReply($"I don't have a safe close shortcut for {spokenName} yet.");

        var requested = 0;
        foreach (var process in Process.GetProcessesByName(app.ProcessName))
        {
            using (process)
            {
                try
                {
                    if (process.MainWindowHandle != IntPtr.Zero && process.CloseMainWindow())
                        requested++;
                }
                catch (InvalidOperationException)
                {
                    // The application may have exited while MAX was checking it.
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // MAX deliberately does not elevate or force-terminate other apps.
                }
            }
        }

        return requested > 0
            ? new AssistantReply($"I asked {app.DisplayName} to close. I won't force it if it has unsaved work.")
            : new AssistantReply($"I couldn't find an open {app.DisplayName} window to close.");
    }

    private static bool TryGetSearch(string text, out string target, out string query)
    {
        target = "google";
        query = string.Empty;

        var patterns = new (string Target, string Pattern)[]
        {
            ("youtube", @"^(?:search\s+)?(?:youtube|you\s+tube)(?:\s+for)?\s*(.*)$"),
            ("google", @"^(?:search\s+)?google(?:\s+for)?\s*(.*)$"),
            ("google", @"^(?:search\s+)?(?:the\s+)?web\s+for\s+(.+)$"),
            ("google", @"^(?:search\s+for|look\s+up|find)\s+(.+)$")
        };

        foreach (var pattern in patterns)
        {
            var match = Regex.Match(text, pattern.Pattern, RegexOptions.IgnoreCase);
            if (!match.Success)
                continue;

            target = pattern.Target;
            query = match.Groups[1].Value.Trim(' ', '.', ',', '?', '!');
            return true;
        }

        return false;
    }

    private static bool TryGetAppCommand(string text, string verb, out string appName)
    {
        var match = Regex.Match(text, $@"^{Regex.Escape(verb)}\s+(.+)$", RegexOptions.IgnoreCase);
        appName = match.Success ? match.Groups[1].Value.Trim() : string.Empty;
        return match.Success && appName.Length > 0;
    }

    private static string NormalizeAppName(string value)
    {
        var name = Clean(value)
            .Replace("please", "", StringComparison.OrdinalIgnoreCase)
            .Trim();

        name = Regex.Replace(name, @"\s+", " ");
        return name.Trim(' ', '.', ',', '?', '!').ToLowerInvariant();
    }

    private static bool IsSleepCommand(string text) =>
        Regex.IsMatch(text, @"\b(?:sleep|go to sleep|that s all|that is all|goodbye|bye max|stop listening)\b", RegexOptions.IgnoreCase);

    private static bool ContainsAny(string text, params string[] phrases) =>
        phrases.Any(phrase => text.Contains(phrase, StringComparison.OrdinalIgnoreCase));

    private static string Clean(string value)
    {
        var text = Regex.Replace(value ?? string.Empty, @"[\p{P}\p{S}]+", " ");
        return Regex.Replace(text, @"\s+", " ").Trim();
    }
}
