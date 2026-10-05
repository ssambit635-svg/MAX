# MAX — Windows desktop companion

MAX is being built as a small, always-on-top Windows desktop pet. It is a **Windows application**, not a terminal chatbot: the first version opens as a floating character, stays available above ordinary desktop apps, and can be shown/hidden from its notification-area icon.

## What the first prototype does

- Sleeps until it hears **“Max”** (the alternate phrase **“Hey Max”** is also accepted to help Windows recognition).
- After waking, listens for one spoken request at a time, speaks a short reply, then returns to its listening state. It goes back to sleep after 40 seconds of silence or when told to sleep.
- Uses the speech recognizer and voice already installed in Windows for wake-word detection, dictation, and spoken replies. This is an OS speech engine, not a generative chat model. MAX does not call an AI API, use Ollama, download a model, or save recordings.
- Opens a small allowlist of apps, requests a graceful close for supported apps, and opens Google or YouTube results in the default browser.
- Has a short set of scripted companion replies. The first build has **no open-ended language model**, so it cannot answer arbitrary questions perfectly or summarize web pages.
- Keeps normal app launching restricted to named shortcuts; it does not run shell commands, read files, or control the screen.

This first version is intentionally a command companion, not the final conversational AI. Training an original language model is a separate research phase. The supplied PC (11th-gen i5, 8 GB RAM, Intel Iris Xe) can run the desktop pet and voice command layer, but is not suitable for training a capable general chat model from scratch.

## Run on Windows without a terminal

The intended user experience is a self-contained `MAX.exe`. The GitHub Actions workflow in `.github/workflows/windows-build.yml` publishes a self-contained x64 build as a downloadable workflow artifact whenever this project is pushed. Extract the artifact and double-click `MAX.exe`.

To build locally, open `MAX.Windows/MAX.Windows.csproj` in Visual Studio 2022 with the .NET 8 desktop workload, then run/publish it. `MAX.Windows/Build-MAX.cmd` is also provided for developers with the .NET 8 SDK installed; the app itself is built as a Windows GUI executable, not a console program.

## Voice setup

MAX uses an English recognizer already installed in Windows. For reliable recognition, install/enable an English speech language, choose the correct microphone as the Windows default input device, and allow desktop apps to use the microphone. Recognition accuracy and delay depend on the microphone, room noise, Windows speech configuration, and accent; no recognizer can guarantee perfect transcription. If MAX stays asleep, check the mic dot: red means speech is offline or paused; right-click the tray icon to open Microphone or Speech settings. Enable an English Windows speech recognizer, select the correct default microphone, then restart MAX. A green dot means the recognizer started; it brightens when it receives audio.

While sleeping, the wake-word grammar is active. After “Max” is heard, the dictation grammar is enabled for up to 40 seconds of conversation. The first prototype accepts the wake word from any nearby speaker; it does **not** identify or authenticate a particular person's voice. Use MAX's notification-area icon to pause the microphone, show the pet, open Windows microphone/speech settings, or exit. The small mic dot is green when wake listening is active, red when paused/offline, and brightens with microphone activity.

## Supported spoken examples

Say “Max”, wait for the spoken greeting, then say one of:

- “Open Notepad and Calculator”
- “Close Chrome”
- “Search Google for …”
- “Search YouTube for …”
- “What time is it?”
- “How are you?”
- “Go to sleep”

Searches open a results page in the default browser; MAX itself does not read or summarize it. Closing an application is a graceful close request only. MAX will not force-terminate an app that might have unsaved work.

## Desktop behavior and limits

The pet is topmost over ordinary Windows applications and can be dragged between monitors. Windows does not permit ordinary apps to draw over secure UAC prompts, the lock screen, or some exclusive full-screen apps. The tray menu includes **Start MAX with Windows**, which is opt-in.

MAX now uses an original transparent 2D moth-kitten mascot, gently bobbing in the native WPF window. No 3D renderer or external character pack is used.

## Repository layout

```text
MAX.Windows/              Native WPF Windows app
  Assistant/              Wake-word listener and deterministic command router
  MainWindow.xaml          Floating desktop pet
  Assets/max-pet.png       Original 2D companion mascot
# P4S — Project.md         Current architecture and roadmap
p4s context.md             Product context and privacy boundaries
```
