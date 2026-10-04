# P4S — Project

## Stack
| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | Small binary, low idle RAM. Frameless + transparent + always-on-top. |
| UI | Svelte 5 + TypeScript + Vite | Fastest to animate sprites, tiny runtime. |
| Backend | Rust (inside Tauri) | Persistence, scheduling, window control, adapters. |
| Data | SQLite via `sqlx` | One file, no server, easy backup. |
| Brain | Ollama over localhost HTTP | OpenAI-compatible, model-swappable. |
| Voice | Windows SAPI / macOS `say` | Zero deps, offline, instant. |
| Notify | `tauri-plugin-notification` | Native reminder popups. |

Rust crates: `tauri`, `tauri-plugin-global-shortcut`, `tauri-plugin-notification`,
`tauri-plugin-single-instance`, `sqlx`, `reqwest`, `tokio`, `serde`, `serde_json`,
`chrono`, `uuid`, `thiserror`, `tracing`.

## File tree
p4s/
├── src/                                  # Svelte frontend
│   ├── lib/
│   │   ├── components/
│   │   │   ├── Pet.svelte                # sprite/canvas renderer + states
│   │   │   ├── ChatPanel.svelte
│   │   │   ├── TodoList.svelte
│   │   │   ├── ReminderBubble.svelte
│   │   │   ├── Settings.svelte
│   │   │   └── Tray menu lives in Rust
│   │   ├── stores/                       # svelte stores
│   │   │   ├── chat.ts                   # messages, streaming state
│   │   │   ├── todos.ts
│   │   │   ├── settings.ts
│   │   │   └── pet.ts                    # mood, position, animation
│   │   └── api.ts                        # typed wrappers over Tauri commands
│   └── routes/+page.svelte
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json                   # transparent, decorations:false, alwaysOnTop
    ├── capabilities/default.json
    └── src/
        ├── main.rs                       # setup, single-instance, autostart
        ├── commands/
        │   ├── mod.rs
        │   ├── chat.rs                   # send_message, abort, clear
        │   ├── todos.rs                  # add, list, complete, remove
        │   ├── reminders.rs              # schedule, snooze, list
        │   ├── settings.rs
        │   └── window.rs                 # move, hide, show, pin, size
        ├── assistant/
        │   ├── mod.rs
        │   ├── provider.rs               # trait AssistantProvider
        │   ├── ollama.rs                 # streaming chat impl
        │   ├── prompt.rs                 # system prompt + personality states
        │   ├── orchestrator.rs           # turn loop, tool dispatch
        │   └── tools.rs                  # allowlisted tool schema + validation
        ├── store/
        │   ├── mod.rs
        │   ├── db.rs                     # pool, migrations
        │   └── models.rs                 # Todo, Reminder, Memory, Settings
        ├── reminders/
        │   ├── mod.rs
        │   ├── scheduler.rs              # tokio interval, fires due reminders
        │   └── notifications.rs
        ├── speech/
        │   ├── mod.rs                    # trait Speak
        │   ├── windows_sapi.rs           # sapi-lite
        │   └── macos_say.rs              # `say -v <voice> -r <rate>`
        └── desktop/
            ├── mod.rs
            ├── shortcuts.rs              # toggle chat, add todo, summon
            └── tray.rs

## Data model (SQLite)
todos      id, title, done, created_at, done_at, due_at NULL
reminders  id, title, fire_at, fired, snoozed_to NULL, pet_line NULL
memories   id, key, value, created_at        -- "name" -> "Sam"
settings   key, value (JSON)                 -- model, voice, rate, roam, pinned

## Tool set exposed to the model
Allowlisted, validated in Rust, args parsed with serde.
- `todo_add(title, due_at?)`
- `todo_list(filter?)`
- `todo_complete(id)`
- `reminder_add(title, fire_at, pet_line?)`
- `remember(key, value)`   -- only on explicit user request

Rule: the model may only *propose* these. Every write goes through the
same validation as a manual click, and destructive actions confirm in UI.

## Shortcuts (pick unused combos; registration can fail)
- `Ctrl+Alt+Space`  summon / dismiss chat
- `Ctrl+Alt+T`      quick-add todo
- `Ctrl+Alt+D`      toggle desktop roam (drag vs free-float)
- `Alt+Esc`         hide pet entirely

## Roadmap
### Phase 1 — Shell (2–3 days)
Transparent always-on-top window, draggable, tray menu, hide/show shortcut.
**Test the packaged build on both OSes early** — transparency in dev
mode has shipped broken in bundled macOS builds before.

### Phase 2 — Useful without AI (2 days)
SQLite + migrations, todos, one-time reminders, notifications,
settings file. Milestone: the app earns its place with the LLM unplugged.

### Phase 3 — Chat brain (2–3 days)
Ollama connection settings, streaming replies, system prompt with
personality states, tool loop with validation, T3 chat bar.
Model default: Qwen3 4B (non-thinking) — small, fast, good at casual
multi-turn chat. Allow any Ollama model.

### Phase 4 — Character (3–4 days)
Sprite state machine, idle animations, speech bubbles, mood driven by
time of day and streak, OS TTS with a voice picker, roam/return-to-corner.

### Phase 5 — Polish (ongoing)
Onboarding, autostart, error states (model down, db locked), multi-monitor
edge, per-pixel click-through, character pack loader (drop in sprites).

## Risks
| Risk | Mitigation |
|---|---|
| Transparent window breaks in packaged macOS build | Test in phase 1, not phase 4 |
| Clicks blocked by empty window area | Per-pixel alpha hit test; fallback to compact hit box |
| Clicks blocked by pet | Suspend click-through while hovered/chat open |
| Model too slow for casual chat | 4B non-thinking model, cap reply length, stream |
| Global shortcut already taken | Detect failure, notify, offer remap |
| Pet gets in the way of work | Roam toggle, quiet hours, never steal focus |

## Non-obvious things to figure out early
1. How does the pet ask for attention without stealing focus?
   (Notification balloon vs. a bubble that fades in — pick one.)
2. Does P4S interrupt mid-task, or queue? (Recommend: queue until idle.)
3. What's the dismissal ritual? A streak counter is cheap motivation.
4. Single instance, always. A second pet that can't see the first
   one's todos is a bug users will hit in week one.
