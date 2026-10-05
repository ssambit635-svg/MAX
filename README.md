# MAX — Windows desktop companion

MAX is a small, always-on-top Windows desktop pet. It is a **Windows application**, not a terminal chatbot: a tiny white ball with little legs floats around the desktop, and a tray icon can show or exit it.

## What MAX does

- Sleeps until it hears **“Max”** (or **“Hey Max”**). You can say **“Max, open Notepad”** in one phrase, or say “Max”, wait for the short reply, and then give a command.
- Uses simple speech grammars for common commands plus Windows dictation for other supported requests. It replies aloud and accepts another request for up to 40 seconds, then sleeps again.
- Opens a small allowlist of apps, requests a graceful close for supported apps, and opens Google or YouTube results in the default browser.
- Gently bobs and wanders around the screen, occasionally disappears for a few seconds, and at a random interval of 2–5 minutes either says a short scripted line or plays a quiet little whistle. When you hover over MAX, its eyes glance toward the pointer; a tap squishes it, and three quick taps make it spin. Pausing the microphone also silences idle sounds.
- Uses the speech recognizer and voice already installed in Windows. This is an OS dependency, not a generative chat model. MAX does not call an AI API, use Ollama, download a model, save recordings, run arbitrary commands, read files, or inspect the screen.

MAX's casual replies and idle remarks are deterministic and limited; it does not retrieve or summarize web pages or answer arbitrary questions like a general chat model.

## Run on Windows without a terminal

The intended user experience is a self-contained x64 app bundle with `MAX.exe` and its small whistle sound asset. The GitHub Actions workflow in `.github/workflows/windows-build.yml` publishes it as a downloadable workflow artifact whenever this project is pushed. Extract the whole artifact and double-click `MAX.exe`; keep the `Assets` folder beside it.

To build locally, open `MAX.Windows/MAX.Windows.csproj` in Visual Studio 2022 with the .NET 8 desktop workload, then run/publish it. `MAX.Windows/Build-MAX.cmd` is also provided for developers with the .NET 8 SDK installed; the app itself is built as a Windows GUI executable, not a console program.

## Voice setup

MAX uses an English recognizer already installed in Windows. For reliable recognition, enable an English speech language, choose the correct microphone as the Windows default input device, and allow desktop apps to use the microphone. Recognition accuracy and delay depend on the microphone, room noise, Windows speech configuration, and accent; no recognizer can guarantee perfect transcription. The small dot is green while the wake listener is active and red if speech is paused or offline. Right-click MAX's tray icon for microphone or speech settings.

MAX accepts the wake phrase from any nearby speaker; it does **not** identify or authenticate a particular person's voice. The tray menu can pause the microphone, show MAX, open Windows microphone/speech settings, enable start-with-Windows, or exit.

## Spoken examples

Either say one complete phrase:

- “Max, open Notepad”
- “Max, open browser”

Or say “Max”, wait for the spoken greeting to finish, then say:

- “Open Notepad”
- “Open browser”
- “Open Calculator”
- “Close Chrome”
- “Search Google for …”
- “Search YouTube for …”
- “What time is it?”
- “How are you?”
- “Go to sleep”

Searches open a results page in the default browser; MAX itself does not read or summarize it. Closing an application is a graceful close request only, so MAX will not force-terminate an app that might have unsaved work.

## Desktop behavior and limits

The pet is topmost over ordinary Windows applications and can be dragged around. Windows does not permit ordinary apps to draw over secure UAC prompts, the lock screen, or some exclusive full-screen apps. The tray menu includes **Start MAX with Windows**, which is opt-in. MAX's hover gaze and click reactions are implemented in its own WPF code, informed by general interaction ideas from [Coucou](https://github.com/Louis-CFM/coucou). No Coucou source code, name, character, icons, or sounds are bundled.

## Repository layout

```text
MAX.Windows/              Native WPF Windows app
  Assistant/              Wake listener and deterministic command router
  MainWindow.xaml          Simple floating white-ball pet
  Assets/max-whistle.wav  Tiny original idle whistle
```
