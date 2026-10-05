# MAX — Windows Desktop Companion

## Product direction
MAX is a small, visible character that lives on the Windows desktop. It sleeps until called by voice, then answers in a casual tone and can carry out a few explicit, safe commands. The character is the product; this is not a general productivity or project-management app.

Agreed first-version scope:
- Windows-native desktop window, always-on-top over ordinary applications, draggable across monitors, with a tray icon and optional start-with-Windows setting.
- Voice-only interaction. While asleep, listen for “Max” and simple one-phrase wake-plus-command requests (for example, “Max, open Notepad”). After waking, accept speech for a short conversation and return to sleep after 40 seconds of silence.
- Open/close a small named list of applications; closing requests are graceful and never force-kill an app.
- Open Google or YouTube search results in the user's default browser. MAX itself does not read or summarize the results.
- Short scripted small talk. No open-ended LLM in the first version.
- No cloud AI, API keys, Ollama, model download, shell execution, screen reading, or file access.

## Windows implementation
| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | WPF on .NET 8 for Windows | Native Windows GUI, transparent/topmost window, no terminal at runtime |
| Voice recognition | Windows Desktop Speech (`System.Speech`) | Uses an English recognizer installed in Windows; no separate AI service |
| Speech output | Windows `SpeechSynthesizer` / installed SAPI voices | Offline OS speech output |
| Command brain | Deterministic C# command router | Fast, inspectable, no generative model or external provider |
| Process actions | Explicit app allowlist + graceful window close | No arbitrary shell commands or force termination |
| Search | Open encoded Google/YouTube result URLs in default browser | No search API key; browser handles internet access |
| Preferences | Current-user Windows registry for optional startup; no conversation database | Minimal persistence in the first version |
| Build | Self-contained `win-x64` publish via GitHub Actions | User can download and double-click MAX.exe without a terminal or .NET install |

The Windows speech recognizer is for turning speech into text; it is not MAX's conversational AI. It must already be available/enabled in Windows. Recognition accuracy depends on the installed speech language, microphone, noise, and speaker; perfect transcription cannot be promised.

## Behavior and safety
- Sleep mode enables the wake phrase and a small direct-command grammar; the active session enables direct app-command phrases plus dictation. Any nearby person who says the wake phrase can wake MAX in v1; voice identity verification is not included.
- Every randomly chosen 2–5 minutes, MAX says a short deterministic idle line or plays a quiet original whistle. Pausing the microphone also pauses these idle sounds.
- No audio or transcript is saved by MAX. Speech stays in the Windows speech stack; command handling is local.
- A search command opens a browser page; it does not grant MAX access to browser contents.
- App launches use named shortcuts. Closing sends a normal close request; unsaved-work dialogs remain under the user's control.
- A tray menu can pause the microphone, show MAX, enable start-with-Windows, or exit.
- The always-on-top pet works over ordinary desktop windows, but Windows secure surfaces (UAC, lock screen) and some exclusive full-screen apps cannot be covered.

## Current prototype layout
```text
MAX.Windows/
├── Assistant/
│   ├── CommandRouter.cs
│   └── WindowsVoiceAssistant.cs
├── App.xaml / App.xaml.cs
├── MainWindow.xaml / MainWindow.xaml.cs
├── MAX.Windows.csproj
└── Build-MAX.cmd
.github/workflows/windows-build.yml
```

## Character
MAX is drawn directly in WPF as a small white ball with tiny legs. It gently hovers, wanders around the screen, and sometimes disappears briefly before reappearing elsewhere. Its eyes follow the pointer only while hovered; a tap squishes it and three quick taps make it spin. The character and its interactions are MAX's own WPF implementation; there are no Coucou/Mochi assets or 3D models.

## Roadmap
1. **Windows pet + command MVP:** visible sleeping character, wake phrase, spoken replies, safe app open/close, browser searches, tray controls, self-contained build.
2. **Windows voice QA:** test on the target PC, adjust installed-language selection, confidence thresholds, wake-word latency, and noise behavior.
3. **Character polish:** tune the white-ball pet's wandering, brief disappear/reappear, and unobtrusive idle lines based on real Windows testing.
4. **Companion depth:** improve conversational behavior and memory only after the voice-first shell is reliable and privacy boundaries are agreed.
5. **Original model research (separate project):** investigate whether a small original model can be trained from a deliberately selected dataset. Do not promise a capable general chat model from the target PC's 8 GB RAM / integrated graphics.

## Hardware expectation
An 11th-gen Intel i5 with 8 GB RAM and integrated Iris Xe graphics is sufficient for the desktop pet, lightweight local speech recognition, app launching, and opening browser searches. It is not suitable for training a high-quality general conversational LLM from scratch with low latency. MAX v1 therefore prioritizes immediate command responsiveness and clear boundaries instead of pretending to provide “perfect” open-ended answers.
