# MAX — Windows Desktop Companion

## Product direction
MAX is a small, visible character that lives in an always-on-top island at the top of the Windows desktop. It sleeps until called by voice, then answers in a casual tone and can carry out a few explicit, safe commands. The character is the product; this is not a general productivity or project-management app.

The visual direction is a Coucou-like island interaction without copying Coucou/Mochi artwork. MAX uses an original illustrated cloud character rendered as WPF geometry, with different moods, eye movement, blinking, lightning sparks, and a dark compact/expanded island. The existing static MAX bitmap is no longer part of the app.

Agreed first-version scope:
- Windows-native desktop island, always-on-top over ordinary applications, click-through outside the visible pill/card, with a tray icon and optional start-with-Windows setting.
- Voice-only interaction. While asleep, listen for “Max” and simple one-phrase wake-plus-command requests (for example, “Max, open Notepad”). After waking, accept speech for a short conversation and return to sleep after 40 seconds of silence.
- Open/close a small named list of applications; closing requests are graceful and never force-kill an app.
- Open Google or YouTube search results in the user's default browser. MAX itself does not read or summarize the results.
- Short scripted small talk. No external AI provider, hosted chat model, Ollama connection, or model download.
- Explicit, user-selected local file access is allowed. MAX may inspect metadata or hold a file reference after a user drops a file into the island, but it must not scan the disk, upload files, or silently read arbitrary folders.

## Windows implementation
| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | WPF on .NET 8 for Windows | Native Windows GUI, transparent/topmost island, no terminal at runtime |
| Character | WPF `MaxPetControl` geometry | Animated original cloud; no static bitmap, third-party character, or external model |
| Voice recognition | Windows Desktop Speech (`System.Speech`) | Uses an English recognizer installed in Windows; no separate AI service |
| Speech output | Windows `SpeechSynthesizer` / installed SAPI voices | Offline OS speech output |
| Command brain | Deterministic C# command router | Fast, inspectable, no generative model or external provider |
| Process actions | Explicit app allowlist + graceful window close | No arbitrary shell commands or force termination |
| Search | Open encoded Google/YouTube result URLs in default browser | No search API key; browser handles internet access |
| File access | User-selected drag/drop only, with size limits | No disk crawl, background upload, or arbitrary path access |
| Preferences | Current-user Windows registry for optional startup; no conversation database | Minimal persistence in the first version |
| Build | Self-contained `win-x64` publish via GitHub Actions | User can download and double-click `MAX.exe` without a terminal or .NET install |

The Windows speech recognizer is for turning speech into text; it is not MAX's conversational AI. It must already be available/enabled in Windows. Recognition accuracy depends on the installed speech language, microphone, noise, and speaker; perfect transcription cannot be promised.

## Behavior and safety
- Sleep mode enables the wake phrase and a small direct-command grammar; the active session enables direct app-command phrases plus dictation. Any nearby person who says the wake phrase can wake MAX in v1; voice identity verification is not included.
- Every randomly chosen 2–5 minutes, MAX says a short deterministic idle line or plays a quiet original whistle. Pausing the microphone also pauses these idle sounds.
- No audio or transcript is saved by MAX. Speech stays in the Windows speech stack; command handling is local.
- A search command opens a browser page; it does not grant MAX access to browser contents.
- App launches use named shortcuts. Closing sends a normal close request; unsaved-work dialogs remain under the user's control.
- File access is explicit: the user must drag a file onto the visible island. Phase 1 reads only its name and size, rejects folders and files over 250 MB, never sends the file anywhere, and does not retain a copy.
- A tray menu can pause the microphone, show MAX, enable start-with-Windows, or exit.
- The always-on-top island works over ordinary desktop windows, but Windows secure surfaces (UAC, lock screen) and some exclusive full-screen apps cannot be covered.

## Current prototype layout
```text
MAX.Windows/
├── Assistant/
│   ├── CommandRouter.cs
│   └── WindowsVoiceAssistant.cs
├── Pet/
│   └── MaxPetControl.cs
├── Assets/
│   └── max-whistle.wav
├── App.xaml / App.xaml.cs
├── MainWindow.xaml / MainWindow.xaml.cs
├── MAX.Windows.csproj
└── Build-MAX.cmd
.github/workflows/windows-build.yml
```

## Coucou-inspired MAX roadmap
1. **Phase 1 — island and character:** animated original cloud pet, compact/expanded top-centre island, click-through empty space, local file metadata drop, tray controls, and self-contained artifact.
2. **Phase 2 — local coding-agent monitor:** optional Claude Code/Codex-style hook event relay and live session cards, without MAX calling an AI API.
3. **Phase 3 — secure approvals:** previewed hook installation, backups, request IDs, allow/deny responses, timeout fallback, and terminal-safe behavior.
4. **Phase 4 — local companion depth:** more deterministic states, keyboard shortcuts, file inbox controls, and settings. No external AI unless explicitly reconsidered.
5. **Phase 5 — selected service integrations:** only services the user chooses, with Windows Credential Manager, narrow scopes, polling limits, and clear pause/remove controls.
6. **Separate project:** investigate any original local model only if a deliberately selected dataset and realistic hardware plan exist. Do not train on all files on the user's PC or promise a capable general model from 8 GB RAM and integrated graphics.

## Hardware expectation
An 11th-gen Intel i5 with 8 GB RAM and integrated Iris Xe graphics is sufficient for the island, animated geometry, lightweight local speech recognition, app launching, safe file metadata handling, and browser searches. It is not suitable for training a high-quality general conversational LLM from scratch with low latency.
