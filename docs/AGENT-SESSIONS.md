# Agent sessions in MAX — implementation contract

## Agreed product scope

- Windows-first desktop experience. Keep the provider boundary portable so macOS/Linux can follow.
- Target Claude Code, Codex CLI, Cursor Agent, and Gemini CLI. Implement providers independently; do not claim support until their adapter has fixture and end-to-end coverage.
- Show live/recent sessions, useful status, and a clear “waiting for you” state. Let the user compose replies and send the next instruction from MAX.
- Local-only. No transcript upload, remote relay, telemetry, or MAX-hosted model.
- User opted in to provider lifecycle hooks only when MAX first shows the exact config diff, makes a dated backup, and offers reliable uninstall/undo.
- Outbound actions use documented provider resume/control mechanisms, never simulated keystrokes or arbitrary shell text. Show the exact text and destination session before every send; explicit confirmation is required.

## Trust and data boundaries

Provider files and hook payloads are untrusted input. Parse with size/depth limits, validate every identifier and enum, and treat all agent text as display-only data (never commands, HTML, or system instructions for MAX). Do not collect full transcripts by default. Keep only the minimum recent session metadata and pending question needed for the feature, with user-visible clear-data controls. Never put prompts, transcripts, project paths, or tokens in diagnostics/logs.

Hook installation must be opt-in and transactional: preserve unknown settings, show a human-readable before/after diff, write a timestamped backup, write atomically, verify the resulting config, and provide an uninstall path that removes only MAX-owned entries. If the existing config cannot be parsed or safely merged, refuse and explain; never overwrite it.

A reply is a consequential action. Bind confirmation to an immutable snapshot of provider, session ID, pending request ID (when present), exact text, and expiry. Revalidate that the target session/request still exists immediately before sending; reject stale, duplicated, or mismatched confirmations. Use argument arrays with an allowlisted executable, never `shell: true` or command-string interpolation. A provider without a documented safe resume mechanism remains monitor-only.

## Delivery phases

1. **Provider contract and fixtures:** normalized session/event types, bounded parsers, Windows-path discovery, malformed/oversize/symlink tests, redaction tests.
2. **Read-only session desk:** opt-in provider discovery, recent/live session list, status and event stream, useful empty/offline states, clear local session data.
3. **Hook setup/undo:** per-provider preview + dated backup + atomic merge + rollback; test preserving unrelated settings and refusing corrupt configs.
4. **Confirmed responses:** per-provider documented resume adapter, preview/confirm, stale-target and duplicate protection, audit activity without saving prompt contents.
5. **Real Windows acceptance:** clean install, each supported agent/version, simultaneous sessions, restart/recovery, hook uninstall, hostile payloads, and no-data-loss checks. Extend platform support only after those checks pass.

## Launch gate

Do not advertise “live” for a provider based only on scanning its history files. Do not enable sending for an adapter without documented resume behavior and a real-provider acceptance test. The feature is not complete until users can inspect and undo hooks, clear MAX's local metadata, and understand what MAX will send before confirming it.
