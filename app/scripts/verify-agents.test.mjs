import assert from "node:assert/strict";
import { AGENT_EVENT_TYPES, AGENT_PROVIDERS, normalizeAgentEvent, publicAgentEvent } from "../server/agents/protocol.mjs";
import { ingestAgentEvent, listSessions, onSessionsChanged, resetSessions } from "../server/agents/sessions.mjs";
import { buildHookCommand, editAgentHookConfig, hookPlanFingerprint, previewDiff, writeAgentConfigAtomically, assertSafeAgentSettingsPath } from "../server/agents/hooks.mjs";
import { translateAgentHookEvent } from "../server/agents/hook.mjs";
import { replyArguments, findAgentCli, prepareAgentReply, confirmAgentReply, resetReplyPreviews } from "../server/agents/replies.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

check("provider hook payloads map to bounded session events without capturing prompts", () => {
  const start = translateAgentHookEvent({ session_id: "session1", cwd: "C:\\work\\MAX", prompt: "private task text" }, "claude-code", "SessionStart");
  assert.equal(start.project, "MAX");
  assert.equal(start.type, "session-start");
  assert.equal(start.text, "");
  const question = translateAgentHookEvent({ session_id: "session1", tool_use_id: "ask1", tool_name: "AskUserQuestion", tool_input: { question: "Which design?" } }, "claude-code", "PreToolUse");
  assert.equal(question.type, "question");
  assert.equal(question.text, "Which design?");
  assert.equal(translateAgentHookEvent({ session_id: "s" }, "codex", "unknown"), null);
});

check("hook config install is idempotent and preserves unrelated provider hooks", () => {
  const before = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other-tool" }] }] }, custom: true });
  const command = "node hook.mjs";
  const once = editAgentHookConfig("claude-code", before, { command });
  const twice = editAgentHookConfig("claude-code", once, { command: "node hook-v2.mjs" });
  const parsed = JSON.parse(twice);
  const group = parsed.hooks.SessionStart[0];
  assert.equal(parsed.custom, true);
  assert.ok(group.hooks.some((hook) => hook.command === "other-tool"));
  assert.equal(JSON.stringify(parsed).match(/MAX_AGENT_HOOK_V1/g)?.length, 7);
});

check("hook uninstall removes only MAX entries and refuses malformed configs", () => {
  const text = editAgentHookConfig("cursor", JSON.stringify({ custom: 7, hooks: { sessionStart: [{ command: "other" }] } }), { command: "node hook.mjs" });
  const clean = JSON.parse(editAgentHookConfig("cursor", text, { uninstall: true }));
  assert.equal(clean.custom, 7);
  assert.deepEqual(clean.hooks.sessionStart, [{ command: "other" }]);
  assert.throws(() => editAgentHookConfig("gemini-cli", "not json", { command: "x" }), /invalid JSON/);
  assert.throws(() => editAgentHookConfig("gemini-cli", JSON.stringify({ hooks: [] }), { command: "x" }), /not an object/);
});

check("hook plans are fingerprinted and commands use quoted absolute paths", () => {
  assert.notEqual(hookPlanFingerprint("codex", "a", "b", "install"), hookPlanFingerprint("codex", "a", "c", "install"));
  const nodePath = String.raw`C:\Node\node.exe`;
  const scriptPath = String.raw`C:\MAX App\hook.mjs`;
  const stateDir = String.raw`C:\Users\A\MAX`;
  const win = buildHookCommand({ provider: "claude-code", event: "SessionStart", nodePath, scriptPath, stateDir, platform: "win32" });
  assert.ok(win.includes(`"${nodePath}"`));
  assert.ok(win.includes("--state-dir"));
  assert.ok(editAgentHookConfig("claude-code", "{}", { command: win }).includes("--max-hook-marker MAX_AGENT_HOOK_V1"));
  assert.throws(() => buildHookCommand({ provider: "claude-code", event: "SessionStart", nodePath, scriptPath, stateDir: String.raw`C:\A&B`, platform: "win32" }), /shell-control/);
});

check("documented resume adapters keep replies in argument slots, never shell strings", () => {
  const text = "answer; $(touch nope) & keep this literal";
  assert.deepEqual(replyArguments("codex", "session_1", text), ["exec", "resume", "session_1", text]);
  assert.deepEqual(replyArguments("gemini-cli", "session_1", text), ["--resume", "session_1", "--prompt", text]);
  assert.equal(replyArguments("claude-code", "session_1", text), null);
  assert.equal(replyArguments("cursor", "session_1", text), null);
  assert.equal(replyArguments("codex", "../outside", text), null);
  assert.equal(replyArguments("codex", "session_1", String.fromCharCode(0) + "bad"), null);
});

check("hook preview redacts secrets and refuses malformed or oversized settings", () => {
  const diff = previewDiff('{"apiKey":"top-secret","keep":true}', '{"apiKey":"top-secret","keep":false}');
  assert.ok(diff.includes("[hidden by MAX]"));
  assert.equal(diff.includes("top-secret"), false);
  assert.throws(() => previewDiff("x".repeat(128_001), "{}"), /too large/);
  assert.throws(() => previewDiff("bad", "{}"), /JSON/);
});

check("hook settings path rejects symlinked parent folders", () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "max-agent-path-"));
  try {
    const real = path.join(dir, "real");
    const linked = path.join(dir, "linked");
    fs.mkdirSync(real);
    fs.symlinkSync(real, linked, "dir");
    assert.throws(() => assertSafeAgentSettingsPath(path.join(linked, "settings.json")), /link/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

check("hook config writes are atomic and keep a dated original backup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "max-agent-hook-"));
  try {
    const target = path.join(dir, "settings.json");
    const backup = path.join(dir, "settings.json.max-backup-test");
    fs.writeFileSync(target, '{"keep":true}\n');
    writeAgentConfigAtomically(target, '{"keep":true,"hooks":{}}\n', backup);
    assert.equal(fs.readFileSync(backup, "utf8"), '{"keep":true}\n');
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).keep, true);
    assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

try {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "max-agent-reply-"));
  const oldPath = process.env.PATH;
  const oldCapture = process.env.MAX_TEST_REPLY_CAPTURE;
  const capture = path.join(sandbox, "args.txt");
  try {
    const cli = path.join(sandbox, "codex.exe");
    fs.writeFileSync(cli, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MAX_TEST_REPLY_CAPTURE\"\n");
    fs.chmodSync(cli, 0o700);
    process.env.PATH = `${sandbox}${path.delimiter}${oldPath ?? ""}`;
    process.env.MAX_TEST_REPLY_CAPTURE = capture;
    resetSessions();
    resetReplyPreviews();
    const now = Date.now();
    ingestAgentEvent({ provider: "codex", type: "question", sessionId: "reply-session", requestId: "reply-request", text: "Pick one" }, now);
    const unsafeLookingButLiteral = "use ; & $(not-a-shell)";
    const preview = prepareAgentReply({ provider: "codex", sessionId: "reply-session", requestId: "reply-request", text: unsafeLookingButLiteral }, now + 1);
    assert.equal(preview.ok, true);
    assert.equal(preview.mode, "resume-cli");
    const sent = await confirmAgentReply(preview.confirmationId, now + 2);
    assert.equal(sent.ok, true);
    for (let attempt = 0; attempt < 50 && !fs.existsSync(capture); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(fs.existsSync(capture), "fake direct CLI never ran");
    const args = fs.readFileSync(capture, "utf8").trimEnd().split("\n");
    assert.deepEqual(args, ["exec", "resume", "reply-session", unsafeLookingButLiteral]);
    const stale = prepareAgentReply({ provider: "codex", sessionId: "reply-session", requestId: "reply-request", text: "stale" }, now + 3);
    ingestAgentEvent({ provider: "codex", type: "session-update", sessionId: "reply-session" }, now + 4);
    const denied = await confirmAgentReply(stale.confirmationId, now + 5);
    assert.equal(denied.ok, false);
    process.stdout.write("PASS  reply confirmation is one-shot, session-bound, and shell-free\n");
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldCapture === undefined) delete process.env.MAX_TEST_REPLY_CAPTURE; else process.env.MAX_TEST_REPLY_CAPTURE = oldCapture;
    resetSessions();
    resetReplyPreviews();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
} catch (error) {
  failed += 1;
  process.stderr.write(`FAIL  confirmed reply integration\n      ${error?.stack ?? error}\n`);
}

try {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "max-agent-api-"));
  const priorState = process.env.MAX_STATE_DIR;
  const priorDist = process.env.MAX_DIST_DIR;
  process.env.MAX_STATE_DIR = path.join(sandbox, "state");
  process.env.MAX_DIST_DIR = path.join(sandbox, "missing-dist");
  try {
    const [{ startServer }, { publishAgentRuntime }] = await Promise.all([
      import("../server/index.mjs"),
      import("../server/agents/token.mjs"),
    ]);
    const running = await startServer({ port: 0, host: "127.0.0.1" });
    try {
      const token = publishAgentRuntime(running.port);
      const root = `http://127.0.0.1:${running.port}`;
      const missingAuth = await fetch(`${root}/api/agents/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      assert.equal(missingAuth.status, 401);
      const accepted = await fetch(`${root}/api/agents/events`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider: "codex", type: "question", sessionId: "api-session", requestId: "api-request", text: "Which option?" }),
      });
      assert.equal(accepted.status, 202);
      const listed = await (await fetch(`${root}/api/agents/sessions`)).json();
      assert.equal(listed.sessions[0].pending.requestId, "api-request");
      const cleared = await fetch(`${root}/api/agents/sessions`, { method: "DELETE" });
      assert.deepEqual((await cleared.json()).sessions, []);
      process.stdout.write("PASS  local hook endpoint authenticates, streams session state, and clears memory\n");
    } finally {
      await running.close();
    }
  } finally {
    if (priorState === undefined) delete process.env.MAX_STATE_DIR; else process.env.MAX_STATE_DIR = priorState;
    if (priorDist === undefined) delete process.env.MAX_DIST_DIR; else process.env.MAX_DIST_DIR = priorDist;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
} catch (error) {
  failed += 1;
  process.stderr.write(`FAIL  local hook API integration\n      ${error?.stack ?? error}\n`);
}

if (failed) process.exitCode = 1;
else process.stdout.write("agent event boundary, hook plans, and session registry are strict\n");
