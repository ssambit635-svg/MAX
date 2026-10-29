# MAX — a calm desktop companion

MAX is a small, always-visible friend that lives on your desktop and does the tiny jobs that
break your flow: open an app, save a note, start a focus block, or show you the numbers from your
own GitHub, LeetCode, Render and VS Code.

It is **not** an AI, it has **no voice**, and it never calls a cloud model. Every action comes from a
hand-written command table, so MAX is instant, inspectable and predictable.

> Design language: a macOS-style dynamic island — flat, opaque near-black ("zed black") surfaces, slow
> eased motion and a pet drawn
> entirely in code, so every expression is honest and sharp at any size.

---

## What it looks like

```
┌──────────────────────────────────────────────┐
│  ◕  MAX │ ● ready            6 commits · 3/3 │  ← the pill, always on top
└──────────────────────────────────────────────┘

expand it (click, or ⌘/Ctrl + K)
┌────────────────────────────────────────────────────────────────┐
│ ◕ MAX   now · code · stats · actions · settings                 │
├───────────────────────┬────────────────────────────────────────┤
│      ◕  (the pet)     │  Right now                             │
│   in focus / happy    │  ● VS Code · max-companion             │
│   "Opened Chrome."    │  ● 3/3 live on Render · 6 commits      │
└───────────────────────┴────────────────────────────────────────┘
```

The pet lives **inside the island** and nowhere else — no second window floating over your work.
It follows your cursor with its eyes, taps back when poked, and naps when you are idle. Drag the
pill (or the panel header) to move MAX anywhere on screen; a plain click opens it.

### Code that corrects itself

A tiny rule engine lives in the island — no local model, no compiler, no network. Open the
**Code** tab, paste a file (or open one), and MAX reviews it across 15 languages and fixes the
things that are safe to fix automatically:

- **errors** — unbalanced brackets, unterminated strings, broken JSON, `gets()`, `DELETE` without `WHERE`
- **warnings** — `==` on strings in Java, bare `except:`, mutable default arguments, `unwrap()`,
  empty `catch`, missing `#include`, `<img>` without `alt`
- **hints** — `var`, `console.log`, `0px`, `!important`, unused imports, long lines, TODOs

Press **Fix** and it applies only behaviour-preserving edits (`==` → `===`, `var` → `let`,
`== None` → `is None`, whitespace, doctype, `lang`). A file with a structural error is never
rewritten — MAX names the line and asks you to fix that first.


## The pet

Drawn in SVG + CSS — no sprite sheets, no Rive, no Lottie, no image files. Eight live expressions,
each driven by what is actually happening:

| Mood | When | What you see |
|---|---|---|
| `idle` | nothing happening | slow breathing, blinking, antenna halo pulse |
| `listening` | you are typing a command | eyes widen, sonar rings |
| `thinking` | a command is running | thought dots, slight tilt |
| `working` | a focus block is running | scanline sweep, focused lids |
| `happy` | success | hop, arc eyes, sparkles |
| `celebrate` | note saved, focus finished | confetti, bounce |
| `sleepy` | idle for 2 minutes | closed eyes, floating `z z z` |
| `error` | the command failed | red antenna, furrowed brows, a sweat drop |

## Commands

Type in the palette (or click a chip). Fuzzy suggestions appear as you type; `↑ ↓` to move,
`Tab` to complete, `↵` to run, `Esc` to close.

```
open chrome            open vs code          open notepad        open terminal
open explorer          open spotify          open settings       close chrome
search github for vite search youtube for lofi search leetcode  google <query>
save note <text>       new note              focus 25            timer 10
stats                  stats github          stats leetcode      stats render
help                   sleep                 wake
```

Apps are launched from an **explicit allowlist** — MAX cannot run an arbitrary shell command, and
closing an app is a graceful request (`taskkill` / `quit` / `pkill`), never a force kill.

## Integrations

| Source | Where the data comes from | Needs a key? |
|---|---|---|
| GitHub | REST API (`/user`, `/repos`, `/events`) — commits today, this week, open PRs, languages, stars | username, token optional for private repos/rate limits |
| LeetCode | public GraphQL endpoint — solved by difficulty, streak, 28-day heatmap, ranking | just your handle |
| Render | Render API v1 — service health and the latest deploy per service | read-only API key |
| VS Code | reads VS Code's own `workspaceStorage` on this machine — running state + recent folders | nothing, it is local |
| This machine | `os.cpus()` / `os.freemem()` — CPU, memory, uptime | nothing |

Until something is connected, that card shows **demo** data with a one-click path to Settings, so the
island never looks empty and you never mistake fake numbers for real ones.

## Privacy

- No account, no telemetry, no cloud model, no voice, no microphone.
- Credentials and preferences live in `.max/config.json` on your machine (`chmod 600`).
- Notes are plain `.md` files in a folder you choose (default `~/Documents/MAX notes`).
- The only network calls are the ones you asked for by connecting an integration.

## Install it on Windows

Every push to `main` builds real installers. Open the Actions tab → the latest **Build MAX** run →
**Artifacts**, and download either:

- **`MAX-windows-x64`** → `MAX-0.2.1-win-x64.exe` (installer, Start-menu shortcut, optional launch at
  login) or `MAX-0.2.1-portable.exe` (single file, nothing installed)
- `MAX-macos` / `MAX-linux` when those runners succeed

The same job runs on every pull request, so a Windows installer that would not build can never land
on `main`.

**New to it on Windows?** [`docs/QUICKSTART-WINDOWS.md`](docs/QUICKSTART-WINDOWS.md) has the exact
install steps (including the SmartScreen step for an unsigned build) and a 10-minute test plan.

## Run it

```bash
cd app
npm install
npm run dev        # island UI on :5173 with the local service on :7999
npm run desktop    # real always-on-top desktop app (Electron)
npm run dist:win   # Windows installer + portable exe
```

`npm run dev` is a browser preview of the same island; `npm run desktop` is the real thing — the
transparent always-on-top window (the island itself is opaque), tray icon, global hotkey (`⌘/Ctrl + Shift + Space`) and
launch-at-login.

## Architecture

```
app/
├── server/            Node HTTP service — no framework, no database
│   ├── index.mjs      REST + SSE, serves the built island, file-safe static
│   ├── commands.mjs   the deterministic command brain + app allowlist
│   ├── integrations.mjs  GitHub / LeetCode / Render / VS Code / system, 60 s cache
│   └── store.mjs      JSON config + note writer
├── src/               React + TypeScript island
│   ├── App.tsx        pill ⇄ island choreography, keyboard, suggestions, moods
│   ├── components/    Pet (SVG), Now, Stats, Actions, Settings
│   └── styles.css     the whole design system
├── electron/          desktop shell: transparent window, tray, hotkey, drag IPC
└── docs/              quickstart, product + command reference
```

The UI talks to the service over `/api/*` (proxied by Vite in dev, same origin in Electron), and the
service pushes activity, notes and settings changes over `text/event-stream` so the island updates
the moment a command lands.

## Status

Working today: island + pill (click to open, drag to move), the pet with eight expressions, command
palette with fuzzy suggestions, first-run guide, note saving, focus timer,
GitHub/LeetCode/Render/VS Code/system stats, settings for all of the above, tray, global hotkey,
CI that typechecks, smokes the API and packages installers for Windows, macOS and Linux.

Next: drag-onto-window context, a small local index of your notes, and a proper onboarding flow for
the first integration.
