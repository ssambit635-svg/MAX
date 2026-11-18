import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createWindowsDictation } from "../electron/dictation.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { writes: [], write(value) { this.writes.push(value); return true; } };
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.signalCode = "SIGTERM";
    child.emit("close", null, "SIGTERM");
    return true;
  };
  return child;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "max-checkpoint-voice-"));
const script = path.join(dir, "dictation.ps1");
fs.writeFileSync(script, "# disposable test fixture\n");
try {
  const child = fakeChild();
  const secondChild = fakeChild();
  let spawnCount = 0;
  const events = [];
  const invocations = [];
  const controller = createWindowsDictation({
    platform: "win32",
    systemRoot: "C:\\Windows",
    scriptPath: script,
    timeoutMs: 60_000,
    spawnChild: (...args) => { invocations.push(args); spawnCount += 1; return spawnCount === 1 ? child : secondChild; },
    onEvent: (event) => events.push(event),
  });

  assert.equal(controller.start("../malicious").ok, false, "untrusted culture should be refused");
  assert.equal(invocations.length, 0, "invalid culture must not spawn a process");
  assert.deepEqual(controller.start("en-US"), { ok: true });
  assert.equal(invocations.length, 1);
  const [executable, args, options] = invocations[0];
  assert.equal(executable, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(args, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-CultureName", "en-US"]);
  assert.equal(options.shell, false, "recognition process must never go through a shell");
  assert.equal(options.windowsHide, true);
  assert.equal(controller.start("hi-IN").ok, false, "a second simultaneous capture must be refused");

  child.stdout.write(`${JSON.stringify({ type: "status", state: "listening" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "text", text: "hello from local dictation" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "text", text: "x".repeat(1001) })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "error", code: "../../leak" })}\n`);
  child.stdout.write("not-json\n");
  assert.deepEqual(events, [
    { type: "status", state: "listening" },
    { type: "text", text: "hello from local dictation" },
  ], "only bounded text and known state events should cross IPC");

  const stopped = controller.stop();
  assert.deepEqual(child.stdin.writes, ["stop\n"]);
  child.exitCode = 0;
  child.emit("close", 0, null);
  await stopped;
  assert.deepEqual(events.at(-1), { type: "status", state: "stopped" });
  assert.deepEqual(controller.start("hi-IN"), { ok: true });
  controller.dispose();
  assert.equal(secondChild.killed, true, "disposing must stop active dictation");

  const unsupported = createWindowsDictation({ platform: "linux", scriptPath: script, spawnChild: () => { throw new Error("must not spawn"); } });
  assert.equal(unsupported.start("en-US").ok, false);

  process.stdout.write("PASS  checkpoints: dictation validates language, uses a fixed shell-free local helper, bounds events, and stops cleanly\n");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
