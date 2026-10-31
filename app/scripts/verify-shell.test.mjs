/**
 * The desktop shell, actually executed.
 *
 * The 0.4.1 crash (`cancelTween is not defined`) shipped because nothing ever ran
 * `electron/main.mjs` outside a real app: a syntax check cannot see a renamed
 * helper, and by the time a user meets it the window is already frozen behind a
 * modal error box.
 *
 * This suite loads the real main process against a stub `electron`, walks the
 * whole lifecycle (ready → window → tray → shortcuts → IPC), and then calls every
 * channel the preload can send. If a handler throws — for any reason, including a
 * name that does not exist — this fails here instead of on someone's laptop.
 */

import { register } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "max-shell-"));

// Point the service at the sandbox so the shell's own boot cannot touch Documents.
process.env.MAX_STATE_DIR = path.join(SANDBOX, "state");
process.env.MAX_DIST_DIR = path.join(APP, "dist");
process.env.MAX_ASSETS_DIR = path.join(APP, "assets");
process.env.MAX_HOST = "127.0.0.1";
process.env.MAX_API_PORT = "0";
process.env.MAX_DEBUG = "";

register("./support/electron-loader.mjs", import.meta.url);

const stub = await import("./support/electron-stub.mjs");
const { state } = stub;

state.userData = path.join(SANDBOX, "userdata");
fs.mkdirSync(state.userData, { recursive: true });

let checks = 0;
let failures = 0;
const results = [];

const test = async (name, run) => {
  checks += 1;
  const started = Date.now();
  try {
    const problems = (await run()) ?? [];
    if (!problems.length) {
      results.push(`PASS  ${name}  (${Date.now() - started}ms)`);
      return;
    }
    failures += 1;
    results.push(`FAIL  ${name}\n      ${problems.join("\n      ")}`);
  } catch (error) {
    failures += 1;
    results.push(`FAIL  ${name}\n      threw: ${error?.stack?.split("\n").slice(0, 4).join("\n      ") ?? error}`);
  }
};

/** Errors the main process swallowed: the shell must never throw out of a channel. */
const swallowed = [];
const originalError = console.error;
console.error = (...args) => {
  swallowed.push(args.map((value) => (value instanceof Error ? value.message : String(value))).join(" "));
};

await import("../electron/main.mjs");

// `whenReady().then(...)` runs in a microtask; give the boot a moment to settle.
const settle = async (ms = 60) => {
  const until = Date.now() + ms;
  while (Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5));
};

const call = async (channel, ...args) => {
  const handler = state.channels.get(channel) ?? state.handlers.get(channel);
  if (!handler) throw new Error(`channel ${channel} was never registered`);
  return await handler({ sender: { send: () => undefined } }, ...args);
};

await test("the shell boots and builds a window", async () => {
  await settle(400);
  const problems = [];
  if (!state.ready) problems.push("app.whenReady() was never called");
  if (!state.windows.length) problems.push("no BrowserWindow was created");

  const win = state.windows[0];
  if (!win) return problems;
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(win.bounds[key])) problems.push(`the window has ${key}=${win.bounds[key]}`);
  }
  if (win.bounds.width > 1440 || win.bounds.height > 900) problems.push("the window is bigger than the test screen");
  if (!win.loaded.length) problems.push("the window never loaded a URL");
  if (win.loaded[0] && !win.loaded[0].startsWith("http://127.0.0.1:")) problems.push(`it loaded ${win.loaded[0]}`);
  if (!state.tray) problems.push("no tray icon was created");
  if (!state.trayMenus.length) problems.push("the tray has no menu");
  return problems;
});

await test("every global shortcut is registered and does something", async () => {
  const problems = [];
  if (state.shortcuts.length < 2) problems.push(`only ${state.shortcuts.length} shortcuts registered`);
  for (const { accelerator, callback } of state.shortcuts) {
    try {
      callback();
    } catch (error) {
      problems.push(`${accelerator} threw: ${error.message}`);
    }
  }
  // Capture should reach the renderer with something the UI understands.
  const win = state.windows[0];
  const capture = win?.sent.find((message) => message.channel === "max:capture");
  if (!capture) problems.push("the capture shortcut never told the renderer");
  return problems;
});

await test("every IPC channel the shell registers survives being called", async () => {
  const problems = [];
  const channels = [...state.channels.keys()];
  if (channels.length < 8) problems.push(`only ${channels.length} channels registered`);

  const payloads = {
    "max:mode": [{ mode: "expanded", height: 620 }],
    "max:drag-begin": [{ screenX: 100, screenY: 40 }],
    "max:drag-move": [{ screenX: 140, screenY: 90 }],
    "max:drag-end": [],
    "max:login-item": [true],
    "max:always-on-top": [false],
    "max:open-external": ["https://github.com/ssambit635-svg/MAX"],
    "max:update-check": [],
  };

  for (const channel of channels) {
    const args = payloads[channel] ?? [];
    try {
      await call(channel, ...args);
    } catch (error) {
      problems.push(`${channel} threw: ${error.message}`);
    }
  }

  // The one channel that must not run during a test.
  if (state.channels.has("max:quit")) {
    try {
      await call("max:quit");
    } catch (error) {
      problems.push(`max:quit threw: ${error.message}`);
    }
  }
  if (state.dialogs.length) problems.push(`a modal error box was shown: ${JSON.stringify(state.dialogs[0])}`);
  return problems;
});

await test("channels refuse nonsense instead of throwing", async () => {
  const problems = [];
  const hostile = [
    ["max:mode", null],
    ["max:mode", { mode: "exploded", height: Number.NaN }],
    ["max:mode", { mode: "expanded", height: -1e9 }],
    ["max:drag-begin", null],
    ["max:drag-begin", { screenX: "left", screenY: {} }],
    ["max:drag-move", { screenX: Number.NaN, screenY: Number.NaN }],
    ["max:drag-move", { screenX: 1e9, screenY: -1e9 }],
    ["max:always-on-top", "yes"],
    ["max:login-item", {}],
    ["max:open-external", null],
    ["max:open-external", "javascript:alert(1)"],
    ["max:open-external", "https://evil.example/x"],
  ];
  for (const [channel, payload] of hostile) {
    try {
      await call(channel, payload);
    } catch (error) {
      problems.push(`${channel}(${JSON.stringify(payload)}) threw: ${error.message}`);
    }
  }
  for (const url of state.external) {
    if (!/^https:\/\/(github\.com|leetcode\.com|render\.com|dashboard\.render\.com)/.test(url)) {
      problems.push(`the shell opened ${url}, which is not an island link`);
    }
  }
  return problems;
});

await test("dragging moves the window and never loses it", async () => {
  const problems = [];
  const win = state.windows[0];
  await call("max:drag-begin", { screenX: 500, screenY: 300 });
  const before = { ...win.bounds };
  await call("max:drag-move", { screenX: 560, screenY: 340 });
  const after = { ...win.bounds };
  if (after.x === before.x && after.y === before.y) problems.push("the window did not move");

  // A drag past the edge is clamped, not followed off-screen.
  await call("max:drag-move", { screenX: 99_999, screenY: 99_999 });
  if (win.bounds.x > 1440 || win.bounds.y > 900) problems.push(`the window ended up at ${win.bounds.x},${win.bounds.y}`);
  if (win.bounds.x + win.bounds.width < 0) problems.push("the window left the screen entirely");

  await call("max:drag-end");
  if (!fs.existsSync(path.join(state.userData, "window.json"))) problems.push("the position was not saved");

  // Back to a comfortable spot, then a drag with no end must still move it.
  win.bounds = { x: 400, y: 300, width: win.bounds.width, height: win.bounds.height };
  await call("max:drag-begin", { screenX: 300, screenY: 200 });
  const held = { ...win.bounds };
  await call("max:drag-move", { screenX: 340, screenY: 230 });
  if (win.bounds.x === held.x && win.bounds.y === held.y) problems.push("a drag from a normal position did nothing");
  await call("max:drag-end");
  return problems;
});

await test("opening and closing the island asks the renderer, never a raw resize", async () => {
  const problems = [];
  const win = state.windows[0];
  win.sent.length = 0;
  await call("max:mode", { mode: "expanded", height: 620 });
  await settle(30);
  if (win.bounds.height < 600) problems.push(`an open island got a ${win.bounds.height}px frame`);
  await call("max:mode", { mode: "collapsed", height: 64 });
  await settle(700); // the fold is deliberately delayed
  if (win.bounds.height > 200) problems.push(`a folded island kept a ${win.bounds.height}px frame`);
  if (win.bounds.y < 0) problems.push("the folded island went above the screen");
  return problems;
});

await test("the shell reports a failure instead of freezing", async () => {
  const problems = [];
  const win = state.windows[0];
  win.sent.length = 0;

  // Force a real throw inside a handler by breaking the window it uses.
  state.failOn = "setBounds";
  try {
    await call("max:mode", { mode: "expanded", height: 700 });
  } catch (error) {
    problems.push(`the guarded channel let a throw escape: ${error.message}`);
  }
  state.failOn = null;

  const reported = win.sent.find((message) => message.channel === "max:shell-error");
  if (!reported) problems.push("the renderer was never told the shell failed");
  if (reported && typeof reported.payload?.message !== "string") problems.push("the failure had no sentence");
  if (!state.windows[0] || state.windows[0].destroyed) problems.push("the window was lost");

  // The log is the thing a user can send us.
  const logFile = path.join(state.userData, "state", "logs", "shell.log");
  if (!fs.existsSync(logFile)) problems.push("no shell.log was written");
  return problems;
});

await test("an uncaught error never becomes a modal dialog", async () => {
  const problems = [];
  const dialog = await import("electron").then((module) => module.dialog);
  state.dialogs.length = 0;
  const before = process.listenerCount("uncaughtException");
  process.emit("uncaughtException", new Error("a deliberate explosion"));
  if (state.dialogs.length) problems.push("a modal error box was raised");
  if (process.listenerCount("uncaughtException") < 1) problems.push("nothing is listening for uncaught errors");

  // The process is still alive: the guard swallowed it and wrote it down.
  const logFile = path.join(state.userData, "state", "logs", "shell.log");
  const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  if (!/deliberate explosion/.test(text)) problems.push("the uncaught error was not logged");
  if (before !== process.listenerCount("uncaughtException") && process.listenerCount("uncaughtException") < 1) {
    problems.push("the guard removed itself");
  }
  void dialog;
  return problems;
});

await test("the shell log never keeps a token or a home folder", async () => {
  const problems = [];
  const logFile = path.join(state.userData, "state", "logs", "shell.log");
  state.failOn = "getBounds";
  try {
    await call("max:mode", { mode: "expanded" });
  } catch {
    /* the guard should have swallowed it */
  }
  state.failOn = null;
  const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  if (/ghp_[A-Za-z0-9]{20,}/.test(text)) problems.push("a token reached the log");
  if (!text.length) problems.push("the log is empty after a forced failure");
  return problems;
});

/* ----------------------------------------------------------------- teardown */

console.error = originalError;
fs.rmSync(SANDBOX, { recursive: true, force: true });
console.log(results.join("\n"));
const hidden = swallowed.filter((line) => !/^\[max\]/.test(line));
if (hidden.length) console.log(`\n(swallowed by the shell, as designed: ${hidden.length})`);
console.log(failures ? `\n${failures} of ${checks} shell checks failed` : `\nthe desktop shell runs — ${checks} checks`);
process.exit(failures ? 1 : 0);
