# MAX — product notes

## What we are building

A desktop companion that feels like a small character living on the laptop, wrapped around a
genuinely fast multitasking engine.

Three ideas, in priority order:

1. **The pet is the product.** A cute, smooth, code-drawn character with real-time expressions that
   reflect what the machine is actually doing. It lives **inside the island** — one window, no
   second sprite floating over your work.
2. **The island is the surface.** A macOS-style dynamic island: a pill when idle, a full glass panel
   when working. Spring physics, blur, hairline borders, one accent color.
3. **The engine is the reason it stays installed.** Small tasks in one keystroke: open an app, save a
   note, start focus, read your stats. No voice, no LLM, no cloud round trip.

## Explicit non-goals

- **No voice and no wake word.** The earlier prototype was voice-first; it is gone. Typing is faster,
  private, deterministic and works in an office, on a train, and at 2 a.m.
- **No generative AI.** MAX does not call a model, hold a chat history or guess. Replies come from a
  finite table you can read in `app/server/commands.mjs`.
- **No arbitrary shell.** Apps come from an allowlist; there is no `eval`, no `sh -c` with user text.
- **No telemetry.**

## Design language

| Token | Value | Where |
|---|---|---|
| Surface | `rgba(9,13,20,.74)` + 34 px backdrop blur | island, cards |
| Hairline | `rgba(255,255,255,.075)` | every border |
| Accent | `#6FE7FF` | focus rings, active tab, pet eyes |
| Positives | `#58E39B`, warnings `#FFC86B`, errors `#FF7D88` | status dots |
| Radius | 32–36 px island, 18–20 px cards, 10–14 px controls | |
| Motion | `cubic-bezier(.32,.72,0,1)` for layout, `cubic-bezier(.34,1.25,.4,1)` for press | |
| Type | SF Pro / Segoe UI Variable, 10–13 px inside the island — deliberately small but never blurry | |

Rules we hold ourselves to:

- One accent color. Color is information, not decoration.
- Nothing moves unless it is reacting to something real.
- Every number on screen is attributable: real data, or clearly marked **demo**.
- `prefers-reduced-motion` and the in-app *Reduce motion* switch stop everything but opacity.

## Pet expressions → state machine

The island owns the mood. It is derived from: last user action (idle → sleepy), an in-flight command
(thinking), a running focus block (working), the result (happy / celebrate / error), and typing
(listening). Mood never leaves the island: one window, one face, nothing floating over the user's work.

## Command grammar

`handleCommand(input)` → `{ ok, message, mood, ui }`.

`ui` is a small instruction set rather than markup: `{ tab, highlight, composer, focusMinutes,
timerMinutes, sleep, savedNote, launched }`. The renderer decides how to animate it. That keeps the
brain free of presentation and the UI free of business rules.

## Roadmap

1. **Now (0.2):** island, pet, commands, notes, focus, stats, settings, packaging.
2. **Next:** onboarding for the first integration, drag-a-file-to-save, note search, per-app focus
   profiles, a compact tray mini-menu.
3. **Later:** optional plugin folder so a user can add their own allowlisted actions as JSON, and
   window-context awareness (what am I looking at) without reading screen contents.
