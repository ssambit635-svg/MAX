# P4S — Desktop Companion · Context

## What this is
A tiny native desktop companion. A character lives on your desktop,
drifts around, chats casually, keeps a short todo list, and pings you
when something is due. It is a presence, not a tool.

## Non-goals (v1)
- No autonomous computer control. P4S never clicks your apps.
- No screen reading, no file access, no shell.
- No account, no cloud, no telemetry. Everything local.
- Not a productivity system. A dozen todos, not Jira.
- No voice input. Text first, TTS optional.

## Principles
1. **Interrupt only when earned.** Silent by default. A pet that nags
   is a pet that gets killed. Reminders fire once, then respect you.
2. **Useful without the AI.** Todos, reminders, and notes must work
   even with no model installed or the model offline.
3. **Small surface, deep texture.** Few controls, but a real
   personality: moods, idle behaviours, small rituals.
4. **Local first.** Local LLM (Ollama) by default, local SQLite,
   OS TTS. Network is an opt-in fallback, never a requirement.
5. **Five-second rule.** Any action a user might want mid-task must
   be reachable in under five seconds, from anywhere, without a menu.
6. **Lose the character, lose the app.** If the pet dies, the todos
   must still be there.

## Personality model
- States: `idle`, `curious`, `thinking`, `speaking`, `sleepy`, `pleased`, `upset`.
- Transitions driven by time of day, recent interaction, todo streaks,
  and how long you have ignored it.
- Speech: short, warm, low-effort. Never corporate. Never a bulleted
  list unless you asked for one. It can be a little annoying on
  purpose — that's the charm — but it earns it with usefulness.

## Memory model
- Tier 1 — Session: full conversation, cleared on quit.
- Tier 2 — Durable: SQLite. Name, preferences, notable facts you
  told it, completed-todo streak.
- Tier 3 — Never: nothing leaves the machine. No embeddings, no
  vector store in v1. Search is plain string match.

## Open questions
- Does the pet wander across multi-monitor boundaries or stay
  on the primary display? (Recommend: stay, to avoid losing it.)
- Per-pixel click-through so clicks pass through empty space?
- Does the pet have a home screen corner to return to, or roam free?
- Do we ship a default character, or let the user drop in their own art?
- One character or a small roster with a switcher?
