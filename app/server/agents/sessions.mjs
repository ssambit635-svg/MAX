import { normalizeAgentEvent, publicAgentEvent } from "./protocol.mjs";

const MAX_SESSIONS = 50;
const MAX_EVENTS = 120;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();
const listeners = new Set();

const stateFor = (type) => ({
  "session-start": "working",
  "session-update": "working",
  "waiting-input": "waiting",
  question: "waiting",
  "permission-request": "waiting",
  "session-finished": "finished",
  "session-error": "error",
}[type] ?? "working");

function sessionKey(event) {
  return `${event.provider}:${event.sessionId}`;
}

function prune(now) {
  for (const [key, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) sessions.delete(key);
  }
  if (sessions.size <= MAX_SESSIONS) return;
  const oldest = [...sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  for (const [key] of oldest.slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(key);
}

function snapshot(session) {
  return {
    provider: session.provider,
    sessionId: session.sessionId,
    project: session.project,
    title: session.title,
    status: session.status,
    updatedAt: session.updatedAt,
    pending: session.pending ? { ...session.pending } : null,
    events: session.events.map((event) => publicAgentEvent(event)).filter(Boolean),
  };
}

function notify(now = Date.now()) {
  const value = listSessions(now);
  for (const listener of listeners) {
    try { listener(value); } catch { /* one subscriber cannot block other sessions */ }
  }
}

/** Add one validated provider event. Session state is memory-only by design. */
export function ingestAgentEvent(input, now = Date.now()) {
  const event = normalizeAgentEvent(input, now);
  if (!event) return { ok: false, message: "That agent event was not valid." };
  prune(now);
  const key = sessionKey(event);
  let session = sessions.get(key);
  if (!session) {
    session = {
      provider: event.provider,
      sessionId: event.sessionId,
      project: event.project,
      title: event.title,
      status: "working",
      updatedAt: event.at,
      pending: null,
      events: [],
    };
    sessions.set(key, session);
  }

  session.project = event.project || session.project;
  session.title = event.title || session.title;
  session.status = stateFor(event.type);
  session.updatedAt = event.at;
  if (event.type === "question" || event.type === "permission-request") {
    session.pending = { type: event.type, requestId: event.requestId, text: event.text, at: event.at };
  } else if (["session-update", "session-finished", "session-error"].includes(event.type)) {
    session.pending = null;
  }

  session.events.push(event);
  session.events = session.events.slice(-MAX_EVENTS);
  notify(now);
  return { ok: true, session: snapshot(session) };
}

export function getAgentSession(provider, sessionId, now = Date.now()) {
  prune(now);
  const session = sessions.get(`${provider}:${sessionId}`);
  return session ? snapshot(session) : null;
}

export function listSessions(now = Date.now()) {
  prune(now);
  return [...sessions.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(snapshot);
}

export function onSessionsChanged(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clear the in-memory session transcript snippets without removing SSE listeners. */
export function clearAgentSessions() {
  sessions.clear();
  notify();
}

/** Test-only reset; deliberately not exposed through an HTTP route. */
export function resetSessions() {
  sessions.clear();
  listeners.clear();
}
