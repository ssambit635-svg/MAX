# MAX — Desktop Companion Context

## What MAX is
MAX is a voice-first companion pet that lives in an always-on-top island at the top of the Windows desktop. A small original illustrated cloud character stays visible, sleeps quietly, and wakes when the user says “Max.” Once awake, MAX can chat with short, friendly scripted replies and carry out a few clear spoken commands. It should feel like a character who happens to be useful—not a productivity suite.

The visual target is an island interaction inspired by the compact/expanded feel of Coucou, but MAX must not copy the Mochi character, artwork, name, sounds, or icons. MAX's cloud, eyes, expressions, lightning effects, and UI are its own implementation in WPF geometry.

## Current goals
- Native Windows GUI: a floating top-centre island with compact and expanded states, transparent click-through space, and a tray icon.
- Voice is the only way to talk to MAX. It sleeps until the wake phrase, supports simple commands in the same phrase as “Max” as well as after waking, listens to the active request, and sleeps again after inactivity or an explicit sleep command.
- Fast, predictable voice commands: open supported apps, politely request that supported apps close, and open Google/YouTube search results in the default browser.
- Explicit local file access is allowed when the user drags a file onto the island. MAX may inspect metadata or hold a reference, but must not scan the disk, read arbitrary folders, or upload the file.
- Keep a recognizable MAX personality with local sounds and animated state changes.
- Do not add an external AI provider, hosted chat model, Ollama service, API key, telemetry, or model download.

## Privacy and boundaries
- No external AI API or remote speech service. Windows speech recognition and speech output remain local OS dependencies.
- No account or telemetry.
- MAX does not scan files, read screens, inspect browser pages, run shell commands, or control arbitrary UI.
- File access is opt-in and user-selected: only a file explicitly dragged onto the visible island may be inspected. Phase 1 reads the file name and size only, rejects folders and files over 250 MB, and does not persist or transmit a copy.
- The sleeping listener recognizes the wake phrase and a small set of wake-plus-command phrases through Windows' installed speech recognizer. The active session uses direct command phrases plus Windows dictation. The first version does not verify speaker identity: anyone nearby who says “Max” can wake it.
- Browser search is an explicit user request. MAX opens the query in the default browser; MAX does not fetch or summarize pages.
- Closing apps is a normal close request only. MAX never force-kills a process to bypass unsaved-work prompts.
- The tray offers a clear microphone-pause control. Start with Windows is opt-in.

## Personality and animation
- Short, warm, natural-sounding spoken replies; no corporate tone.
- MAX occasionally says one short deterministic idle line or plays a quiet original whistle at a random 2–5 minute interval; the mic-pause control silences these sounds.
- The cloud pet is drawn live by `MAX.Windows/Pet/MaxPetControl.cs`: it blinks, tracks the pointer while hovered, changes expressions for sleep/listen/speak/happy/offline states, bobs gently, and emits small lightning sparks while active.
- The compact island is top-centre. Hovering or clicking expands it; the expanded card shows the current voice state and a secure local file-drop surface.

## Future Coucou-inspired work
- Add a local coding-agent hook relay that only observes local session events and never calls an AI API.
- Add secure, previewed approvals only after the relay has request IDs, timeouts, backups, and terminal fallback.
- Add deterministic session cards, keyboard shortcuts, settings, and optional service integrations behind Windows Credential Manager if explicitly requested.
- Do not silently reintroduce external AI, cloud chat, file uploads, or broad filesystem access.

## Hardware expectation
An 11th-gen Intel i5 with 8 GB RAM and integrated Intel Iris Xe graphics can run the island, animated WPF character, local speech layer, safe app actions, and explicit file metadata handling. It is not a realistic machine for training a capable open-domain language model from scratch.
