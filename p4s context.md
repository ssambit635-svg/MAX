# MAX — Desktop Companion Context

## What MAX is
MAX is a voice-first companion pet that lives on the Windows desktop. A small character stays visible, sleeps quietly, and wakes when the user says “Max.” Once awake, MAX can chat with short, friendly scripted replies and carry out a few clear spoken commands. It should feel like a character who happens to be useful—not a productivity suite.

The first version is intentionally not a general-purpose generative AI. It has no generative language model, API key, Ollama service, or cloud assistant. Its command behavior is written in the MAX app and it uses the speech-recognition engine and speech voice already installed in Windows to hear the user and speak replies. That OS speech engine is the only speech dependency; it is not a separate chat model to configure. As a result, casual conversation is limited and arbitrary questions will not receive model-quality answers.

## First-version goals
- Native Windows GUI: a floating, draggable, always-on-top pet; no terminal window during use.
- Voice is the only way to talk to MAX. It sleeps until the wake phrase, listens to the active request, speaks back, and sleeps again after inactivity or an explicit sleep command.
- Fast, predictable voice commands: open supported apps, politely request that supported apps close, and open Google/YouTube search results in the default browser.
- Simple small talk and a recognisable pet personality.
- The user can pause the microphone or exit from a small tray menu.
- Keep the interface unobtrusive and never steal focus during normal use.

## Privacy and boundaries
- No cloud AI, account, API key, telemetry, or remote speech service.
- MAX does not scan files, read screens, inspect browser pages, run shell commands, or control arbitrary UI.
- MAX does not save recordings or conversation transcripts.
- The sleeping listener recognizes only the wake phrase through Windows' installed speech recognizer. The active session uses Windows dictation. The first version does not verify speaker identity: anyone nearby who says “Max” can wake it.
- Browser search is an explicit user request. MAX opens the query in the default browser; MAX does not fetch or summarize pages.
- Closing apps is a normal close request only. MAX never force-kills a process to bypass unsaved-work prompts.
- The tray offers a clear microphone-pause control. Start with Windows is opt-in.

## Personality
- Short, warm, natural-sounding spoken replies; no corporate tone.
- MAX waits rather than initiating conversation or nagging.
- The character may show sleeping, listening, thinking, speaking, and pleased states, but the v1 command brain is deterministic and does not infer emotions from audio.
- Speech output uses an installed Windows voice. Speech recognition quality depends on the Windows language pack, microphone, room noise, and voice; accuracy and latency must be tested on the target PC.

## Character
Pikachu is the chosen character art. The supplied ZIP contains an FBX 3D mesh and texture maps, so it needs an import/render/animation step rather than being usable directly as a 2D sprite. The current WPF prototype uses lightweight vector stand-in art until that pipeline is implemented and tested.

## Future model work
An original MAX language model is a possible later research milestone, not part of the command MVP. Training requires a well-defined, deliberately chosen dataset, training code, and suitable compute. Do not automatically train on all files on the user's PC. The target machine (i5-1155G7, 8 GB RAM, integrated Intel Iris Xe) can run the pet and voice-command layer but is not a realistic machine for training a capable open-domain language model from scratch.
