import assert from "node:assert/strict";
import { AGENT_EVENT_TYPES, AGENT_PROVIDERS, normalizeAgentEvent, publicAgentEvent } from "../server/agents/protocol.mjs";
import { ingestAgentEvent, listSessions, onSessionsChanged, resetSessions } from "../server/agents/sessions.mjs";

let failed = 0;
function check(name, run) {
  try {
    run();
    process.stdout.write(`PASS  ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL  ${name}\n      ${error.message}\n`);
  }
}

check("declares the intended major provider and event vocabulary", () => {
  assert.deepEqual(AGENT_PROVIDERS, ["claude-code", "codex", "cursor", "gemini-cli"]);
  assert.ok(AGENT_EVENT_TYPES.includes("waiting-input"));
});

check("accepts a valid normalized session update", () => {
  const event = normalizeAgentEvent({
    provider: "claude-code", type: "session-update", sessionId: "session-abc_123",
    project: "MAX", title: "Fix tests", text: "private transcript must be dropped", cwd: "C:\\secret\\repo",
    at: 1000, token: "secret",
  }, 2000);
  assert.deepEqual(event, {
    provider: "claude-code", type: "session-update", sessionId: "session-abc_123", requestId: null,
    project: "MAX", title: "Fix tests", text: "", at: 1000,
  });
  assert.equal(JSON.stringify(event).includes("secret"), false);
});

check("rejects unknown providers, event kinds, malformed objects and invalid IDs", () => {
  for (const payload of [
    null,
    [],
    { provider: "unknown", type: "session-start", sessionId: "x" },
    { provider: "codex", type: "execute-shell", sessionId: "x" },
    { provider: "cursor", type: "session-start", sessionId: "../../bad" },
    { provider: "gemini-cli", type: "session-start", sessionId: "" },
  ]) assert.equal(normalizeAgentEvent(payload, 10_000), null);
});

check("requires a request id for questions and permission requests", () => {
  for (const type of ["question", "permission-request"]) {
    assert.equal(normalizeAgentEvent({ provider: "codex", type, sessionId: "s1", text: "Allow?" }, 10_000), null);
  }
  assert.ok(normalizeAgentEvent({ provider: "codex", type: "question", sessionId: "s1", requestId: "r1", text: "Allow?" }, 10_000));
});

check("bounds text, strips control characters, and rejects future timestamps", () => {
  const event = normalizeAgentEvent({
    provider: "gemini-cli", type: "question", sessionId: "s1", requestId: "r1",
    text: `hello\u0000\u0007${"x".repeat(5000)}`, at: 99_999,
  }, 10_000);
  assert.equal(event.text.length, 4000);
  assert.equal(event.text.includes("\u0000"), false);
  assert.equal(event.at, 10_000);
});

check("public event serialization only accepts normalized known event types", () => {
  const event = normalizeAgentEvent({ provider: "cursor", type: "session-finished", sessionId: "s" }, 1000);
  assert.deepEqual(publicAgentEvent(event), event);
  assert.equal(publicAgentEvent({ ...event, type: "shell-command" }), null);
});

check("session desk updates status and clears handled questions", () => {
  resetSessions();
  const start = ingestAgentEvent({ provider: "codex", type: "session-start", sessionId: "s1", project: "MAX" }, 1000);
  assert.equal(start.ok, true);
  assert.equal(listSessions(1000)[0].status, "working");
  ingestAgentEvent({ provider: "codex", type: "question", sessionId: "s1", requestId: "q1", text: "Choose a design" }, 2000);
  assert.equal(listSessions(2000)[0].pending.requestId, "q1");
  ingestAgentEvent({ provider: "codex", type: "session-update", sessionId: "s1" }, 3000);
  assert.equal(listSessions(3000)[0].pending, null);
  assert.equal(listSessions(3000)[0].status, "working");
  resetSessions();
});

check("session hub rejects bad payloads and publishes bounded state changes", () => {
  resetSessions();
  const seen = [];
  const unsubscribe = onSessionsChanged((sessions) => seen.push(sessions.length));
  assert.equal(ingestAgentEvent({ provider: "codex", type: "shell", sessionId: "s1" }, 1000).ok, false);
  for (let i = 0; i < 60; i += 1) {
    ingestAgentEvent({ provider: "gemini-cli", type: "session-start", sessionId: `s${i}` }, 2000 + i);
  }
  assert.equal(listSessions(2100).length, 50);
  assert.equal(seen.length, 60);
  unsubscribe();
  resetSessions();
});

if (failed) process.exitCode = 1;
else process.stdout.write("agent event boundary and session registry are strict\n");
