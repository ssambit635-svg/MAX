// Strict provider-neutral boundary for local coding-agent lifecycle events.
// Provider hook payloads are untrusted data: never pass these strings to a shell,
// use them as HTML, or let paths/credentials escape into diagnostics.

export const AGENT_PROVIDERS = Object.freeze(["claude-code", "codex", "cursor", "gemini-cli"]);
export const AGENT_EVENT_TYPES = Object.freeze([
  "session-start",
  "session-update",
  "waiting-input",
  "question",
  "permission-request",
  "session-finished",
  "session-error",
]);

const MAX_ID = 160;
const MAX_LABEL = 120;
const MAX_TEXT = 4000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function boundedText(value, limit) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, limit);
}

function validId(value) {
  const id = boundedText(value, MAX_ID);
  return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

/**
 * Convert an arbitrary provider hook payload into the only event shape the MAX
 * session desk may consume. Returns null for invalid/provider-unknown payloads.
 * Deliberately drops cwd, transcript bodies, environment variables and tokens.
 */
export function normalizeAgentEvent(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const provider = AGENT_PROVIDERS.includes(input.provider) ? input.provider : null;
  const type = AGENT_EVENT_TYPES.includes(input.type) ? input.type : null;
  const sessionId = validId(input.sessionId);
  if (!provider || !type || !sessionId) return null;

  const time = Number(input.at);
  const timestamp = Number.isFinite(time) && time > 0 && time <= now + 60_000 ? time : now;
  const requestId = validId(input.requestId);
  const text = boundedText(input.text, MAX_TEXT);

  // Ask/permission events must be actionable, addressable and user-visible.
  if ((type === "question" || type === "permission-request") && !requestId) return null;

  return Object.freeze({
    provider,
    type,
    sessionId,
    requestId: requestId || null,
    project: boundedText(input.project, MAX_LABEL) || "Unknown project",
    title: boundedText(input.title, MAX_LABEL) || provider,
    text: type === "question" || type === "permission-request" ? text : "",
    at: timestamp,
  });
}

/** Token-free UI form: never expose IDs that are usable as local process args. */
export function publicAgentEvent(event) {
  if (!event || !AGENT_PROVIDERS.includes(event.provider) || !AGENT_EVENT_TYPES.includes(event.type)) return null;
  return {
    provider: event.provider,
    type: event.type,
    sessionId: event.sessionId,
    requestId: event.requestId,
    project: event.project,
    title: event.title,
    text: event.text,
    at: event.at,
  };
}
