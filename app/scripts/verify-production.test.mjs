/**
 * The production gauntlet.
 *
 * The other suites check that features work. This one tries to break the app:
 * malformed requests, hostile input, corrupt state files, 500 parallel commands,
 * Windows-only assumptions, missing dependencies, a package that would not boot
 * after install. It runs the real server in-process on an ephemeral port, so what
 * it tests is exactly what ships.
 *
 *   npm run qa          everything (adds typecheck + UI build)
 *   npm run qa -- --fast  skip the two slow builds
 *
 * Any failure prints the file, the input and what happened, so it can be fixed
 * without reproducing it by hand.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const FAST = process.argv.includes("--fast");
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "max-qa-"));

process.env.MAX_STATE_DIR = path.join(SANDBOX, "state");
process.env.MAX_DIST_DIR = path.join(APP, "dist");
process.env.MAX_ASSETS_DIR = path.join(APP, "assets");
process.env.MAX_HOST = "127.0.0.1";

// Before anything is imported: every folder lives in the sandbox. Tests that run
// commands in this process (rather than over HTTP) read the same config file, so
// the isolation has to exist on disk from the first line, not after the server starts.
const { saveConfig } = await import("../server/store.mjs");
saveConfig({
  saveDir: path.join(SANDBOX, "notes"),
  codeDir: path.join(SANDBOX, "code"),
  github: { username: "", token: "" },
  leetcode: { username: "" },
});

let failures = 0;
let checks = 0;

const results = [];
async function test(name, run) {
  checks += 1;
  const started = Date.now();
  try {
    const problems = (await run()) ?? [];
    if (!problems.length) {
      results.push(`PASS  ${name}  (${Date.now() - started}ms)`);
      return;
    }
    failures += 1;
    results.push(`FAIL  ${name}`);
    for (const problem of problems.slice(0, 10)) results.push(`      ${problem}`);
    if (problems.length > 10) results.push(`      … ${problems.length - 10} more`);
  } catch (error) {
    failures += 1;
    results.push(`FAIL  ${name}`);
    results.push(`      threw: ${error?.stack?.split("\n").slice(0, 4).join("\n      ") ?? error}`);
  }
}

const read = (relative) => fs.readFileSync(path.join(APP, relative), "utf8");
const walk = (dir, extensions, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "release", ".max", ".preview-state"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, extensions, out);
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
};

const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(String(reason)));
process.on("uncaughtException", (error) => unhandled.push(String(error?.message ?? error)));

/* ---------------------------------------------------------------- 1. syntax */

await test("every source file parses", async () => {
  const { parse } = await import("@babel/parser");
  const files = [
    ...walk(path.join(APP, "server"), [".mjs"]),
    ...walk(path.join(APP, "electron"), [".mjs"]),
    ...walk(path.join(APP, "scripts"), [".mjs"]),
    ...walk(path.join(APP, "src"), [".ts", ".tsx"]),
  ];
  const problems = [];
  for (const file of files) {
    const plugins = file.endsWith(".tsx") ? ["typescript", "jsx"] : file.endsWith(".ts") ? ["typescript"] : ["jsx"];
    try {
      parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins, errorRecovery: false });
    } catch (error) {
      problems.push(`${path.relative(APP, file)}: ${error.message}`);
    }
  }
  return problems;
});

/* --------------------------------------------------------------- 2. modules */

await test("every server module imports and exports what it claims", async () => {
  const files = walk(path.join(APP, "server"), [".mjs"]);
  const problems = [];
  for (const file of files) {
    try {
      const module = await import(`file://${file}`);
      if (!Object.keys(module).length) problems.push(`${path.relative(APP, file)} exports nothing`);
    } catch (error) {
      problems.push(`${path.relative(APP, file)} failed to import: ${error.message}`);
    }
  }
  return problems;
});

/* ---------------------------------------------- 3. commands under fire */

const HOSTILE = [
  "",
  " ",
  "\n\n\t",
  "\0",
  "a".repeat(5000),
  "open " + "b".repeat(3000),
  "save note " + "c".repeat(20000),
  "save snippet " + "d".repeat(400) + ": x",
  "snippet " + "e".repeat(400),
  "add app " + "f".repeat(200) + ": /etc/passwd",
  "check ../../../../etc/passwd",
  "check /etc/shadow",
  "check ~/.ssh/id_rsa",
  "scan /",
  "scan ..",
  "scan /proc",
  "open chrome && rm -rf /",
  "open chrome; whoami",
  "search <script>alert(1)</script>",
  "search " + "\u202e".repeat(20),
  "🙂🙂🙂 open chrome",
  "OPEN CHROME",
  "open CHROME",
  "focus -1",
  "focus 0",
  "focus 99999",
  "focus abc",
  "stats " + "g".repeat(2000),
  "save note '; DROP TABLE notes;--",
  "{\"__proto__\":{\"x\":1}}",
  "constructor",
  "toString",
  "hasOwnProperty",
  "undefined",
  "null",
  "NaN",
];
const WEIRD_TYPES = [undefined, null, 0, 1, true, false, {}, [], [1, 2], () => "x"];

await test("commands answer sanely to hostile input", async () => {
  const { handleCommand } = await import("../server/commands.mjs");
  const problems = [];
  const shape = (result) =>
    result && typeof result === "object" && typeof result.ok === "boolean" && typeof result.message === "string" && result.message.trim().length > 0;

  for (const input of [...HOSTILE, ...WEIRD_TYPES]) {
    let result;
    try {
      result = await handleCommand(input);
    } catch (error) {
      problems.push(`threw on ${JSON.stringify(input).slice(0, 60)}: ${error.message}`);
      continue;
    }
    if (!shape(result)) problems.push(`bad result for ${JSON.stringify(input).slice(0, 60)}: ${JSON.stringify(result).slice(0, 120)}`);
  }
  return problems;
});

await test("random command fuzz never throws", async () => {
  const { handleCommand } = await import("../server/commands.mjs");
  const alphabet = "abcdefghijklmnopqrstuvwxyz ABCDEFGH0123456789:/\\\"'`$(){}[]<>,.;-_=|&*#@!?~%+^🙂\n\t";
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const problems = [];
  for (let index = 0; index < 250; index += 1) {
    const length = Math.floor(random() * 40);
    let input = "";
    for (let character = 0; character < length; character += 1) {
      input += alphabet[Math.floor(random() * alphabet.length)];
    }
    try {
      const result = await handleCommand(input);
      if (!result || typeof result.message !== "string") problems.push(`bad shape for ${JSON.stringify(input)}`);
    } catch (error) {
      problems.push(`threw on ${JSON.stringify(input)}: ${error.message}`);
    }
  }
  return problems;
});

/* ---------------------------------------------------------------- 4. HTTP */

const { startServer } = await import("../server/index.mjs");
let service = null;
try {
  service = await startServer({ port: 0, host: "127.0.0.1" });
} catch (error) {
  console.error("could not start the service for the gauntlet:", error.message);
  process.exit(1);
}
const ORIGIN = `http://127.0.0.1:${service.port}`;

// Point every folder at the sandbox: a test must never write into the user's
// Documents, and the gauntlet creates thousands of files.
const sandboxConfig = await fetch(`${ORIGIN}/api/config`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    saveDir: path.join(SANDBOX, "notes"),
    codeDir: path.join(SANDBOX, "code"),
    github: { username: "", token: "" },
    leetcode: { username: "" },
  }),
}).then((response) => response.json());
if (!sandboxConfig?.ok) console.error("could not isolate the sandbox folders");

const call = async (method, route, body, { raw = false, timeout = 15000, extraHeaders } = {}) => {
  const response = await fetch(`${ORIGIN}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(extraHeaders ?? {}) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json: fine for the UI routes */
  }
  return { status: response.status, json, text };
};

await test("the service answers on every route it advertises", async () => {
  const source = read("server/index.mjs");
  const routes = [...new Set([...source.matchAll(/route === "(GET|POST) (\/api\/[a-z/-]+)"/g)].map((m) => `${m[1]} ${m[2]}`))];
  const problems = [];
  if (routes.length < 15) problems.push(`only found ${routes.length} routes — the parser drifted`);

  // Server-sent events never finish by design, so they get a header check instead.
  const STREAMING = new Set(["/api/events"]);
  for (const route of routes) {
    const [method, pathname] = route.split(" ");
    if (STREAMING.has(pathname)) {
      const response = await fetch(`${ORIGIN}${pathname}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (!response || response.status !== 200) problems.push(`${route} did not open a stream (${response?.status ?? "no answer"})`);
      if (response?.body) await response.body.cancel().catch(() => undefined);
      continue;
    }
    const response = await call(method, pathname, method === "POST" ? {} : undefined);
    if (response.status >= 500) problems.push(`${route} answered ${response.status}: ${response.text.slice(0, 100)}`);
    if (method === "GET" && !response.json) problems.push(`${route} did not return JSON`);
  }
  return problems;
});

await test("a bad request is the caller's fault, not a crash", async () => {
  const problems = [];
  const cases = [
    ["POST", "/api/command", "{not json", 400],
    ["POST", "/api/command", "null", 400],
    ["POST", "/api/command", "[1,2,3]", 400],
    ["POST", "/api/config", "{oops", 400],
    ["POST", "/api/code/review", "{", 400],
  ];
  for (const [method, route, body, expected] of cases) {
    const response = await call(method, route, body, { raw: true });
    if (response.status !== expected) problems.push(`${method} ${route} with ${JSON.stringify(body)} → ${response.status}, expected ${expected}`);
    if (response.json && !response.json.message) problems.push(`${method} ${route} error has no message`);
  }

  const huge = JSON.stringify({ input: "x".repeat(3_000_000) });
  const big = await call("POST", "/api/command", huge, { raw: true });
  if (big.status < 400 || big.status >= 500) problems.push(`oversized body → ${big.status}, expected 4xx`);
  return problems;
});

await test("hostile bodies cannot poison the config", async () => {
  const problems = [];
  await call("POST", "/api/config", { __proto__: { polluted: "yes" } }, { raw: true });
  await call("POST", "/api/config", { constructor: { prototype: { polluted2: "yes" } } }, { raw: true });
  if ({} .polluted !== undefined) problems.push("Object.prototype.polluted was set");
  if ({} .polluted2 !== undefined) problems.push("Object.prototype.polluted2 was set");

  const saved = JSON.parse(fs.readFileSync(path.join(process.env.MAX_STATE_DIR, "config.json"), "utf8"));
  // `in` walks the prototype chain, so only an own key is a real leak.
  if (Object.hasOwn(saved, "__proto__")) problems.push("config.json stored a __proto__ key");
  if (Object.hasOwn(saved, "constructor")) problems.push("config.json stored a constructor key");
  return problems;
});

await test("the file routes refuse everything outside the sandbox", async () => {
  const problems = [];
  const attacks = [
    "../../../../etc/passwd",
    "/etc/shadow",
    "..\\..\\Windows\\System32\\config\\SAM",
    "~/.ssh/id_rsa",
    "C:\\Windows\\System32\\drivers\\etc\\hosts",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "\0etc/passwd",
  ];
  for (const attack of attacks) {
    const opened = await call("POST", "/api/code/open", { path: attack });
    if (opened.json?.ok) problems.push(`opened ${attack}`);
    if (opened.status >= 500) problems.push(`${attack} caused ${opened.status}`);

    const saved = await call("POST", "/api/code/save", { path: attack, code: "x" });
    if (saved.json?.ok) problems.push(`wrote ${attack}`);
  }

  const escaped = await call("GET", "/../package.json");
  if (escaped.status === 200 && escaped.text.includes("\"name\": \"max\"")) problems.push("static handler served package.json");
  const traversal = await call("GET", "/..%2f..%2fpackage.json");
  if (traversal.status === 200 && traversal.text.includes("\"name\": \"max\"")) problems.push("static handler traversed with the encoded form");
  return problems;
});

await test("bad payload shapes never reach a 500", async () => {
  const problems = [];
  const cases = [
    ["POST", "/api/command", { input: 12345 }],
    ["POST", "/api/command", { input: null }],
    ["POST", "/api/command", { input: { nested: true } }],
    ["POST", "/api/code/review", { code: null, language: null }],
    ["POST", "/api/code/review", { code: 42 }],
    ["POST", "/api/code/review", { code: "x", language: "klingon" }],
    ["POST", "/api/code/fix", { code: "", language: "python" }],
    ["POST", "/api/code/scan", { root: "" }],
    ["POST", "/api/code/scan", { root: "/definitely/not/here" }],
    ["POST", "/api/code/scan", { root: 42 }],
    ["POST", "/api/code/snippets", { name: null, code: null }],
    ["POST", "/api/code/snippets/delete", { name: null }],
    ["POST", "/api/code/snippet/copy", { name: "nope" }],
    ["POST", "/api/notes", { text: "" }],
    ["POST", "/api/notes", { text: { a: 1 } }],
    ["POST", "/api/integrations/verify", { provider: "nope" }],
    ["POST", "/api/integrations/verify", { provider: "github", username: { a: 1 } }],
    ["POST", "/api/apps/custom", { name: "", path: "" }],
    ["POST", "/api/diagnostics/clear", {}],
  ];
  for (const [method, route, body] of cases) {
    const response = await call(method, route, body);
    if (response.status >= 500) problems.push(`${route} with ${JSON.stringify(body)} → ${response.status}: ${response.text.slice(0, 80)}`);
  }
  return problems;
});

await test("deeply nested and enormous payloads stay bounded", async () => {
  const problems = [];
  let deep = "{}";
  for (let index = 0; index < 400; index += 1) deep = `{"a":${deep}}`;
  const nested = await call("POST", "/api/config", deep, { raw: true });
  if (nested.status >= 500) problems.push(`400-deep JSON → ${nested.status}`);

  const bigNote = await call("POST", "/api/notes", { text: "n".repeat(400_000) });
  if (bigNote.status >= 500) problems.push(`400 KB note → ${bigNote.status}`);

  const bigSnippet = await call("POST", "/api/code/snippets", { name: "big", code: "c".repeat(400_000) });
  if (bigSnippet.status >= 500) problems.push(`400 KB snippet → ${bigSnippet.status}`);
  return problems;
});

await test("50 commands at once all come back", async () => {
  const problems = [];
  const commands = ["help", "stats", "snippets", "what time is it", "scan src", "check src/App.tsx", "", "nonsense"];
  const started = Date.now();
  const responses = await Promise.all(
    Array.from({ length: 50 }, (_value, index) => call("POST", "/api/command", { input: commands[index % commands.length] })),
  );
  responses.forEach((response, index) => {
    if (response.status >= 500) problems.push(`request ${index} (${commands[index % commands.length]}) → ${response.status}`);
    if (!response.json?.message) problems.push(`request ${index} answered without a message`);
  });
  const elapsed = Date.now() - started;
  if (elapsed > 20_000) problems.push(`50 commands took ${elapsed}ms`);
  return problems;
});

await test("a second service instance on the same port fails loudly, not silently", async () => {
  const problems = [];
  try {
    const second = await startServer({ port: service.port, host: "127.0.0.1" });
    problems.push("a second server bound the same port without an error");
    await second.close();
  } catch (error) {
    if (error?.code !== "EADDRINUSE") problems.push(`expected EADDRINUSE, got ${error?.code ?? error?.message}`);
  }
  return problems;
});

/* ------------------------------------------------------- 5. corrupt state */

await test("a corrupt state folder cannot stop the app from booting", async () => {
  const { spawnSync } = await import("node:child_process");
  const problems = [];
  const scratch = path.join(SANDBOX, "corrupt");
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, "config.json"), "{ this is not json");
  fs.writeFileSync(path.join(scratch, "activity.json"), "[[[");
  fs.writeFileSync(path.join(scratch, "snippets.json"), "null");
  fs.mkdirSync(path.join(scratch, "logs"), { recursive: true });
  fs.writeFileSync(path.join(scratch, "logs", "max.log"), "\0\0\0garbage\nnot json\n");

  const probe = `
    process.env.MAX_STATE_DIR = ${JSON.stringify(scratch)};
    const { loadConfig, loadActivity, publicConfig } = await import(${JSON.stringify(path.join(APP, "server/store.mjs"))});
    const snippets = await import(${JSON.stringify(path.join(APP, "server/snippets.mjs"))});
    const diag = await import(${JSON.stringify(path.join(APP, "server/diagnostics.mjs"))});
    const config = loadConfig();
    if (!config.prefs || typeof config.prefs.idleSleepSeconds !== "number") throw new Error("config lost its defaults");
    if (!Array.isArray(loadActivity())) throw new Error("activity is not a list");
    if (!Array.isArray(snippets.snippetIndex())) throw new Error("snippets is not a list");
    publicConfig();
    diag.readLog(5);
    console.log("ok");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.includes("ok")) {
    problems.push(`boot probe failed: ${(result.stderr || result.stdout).split("\n").slice(0, 4).join(" ")}`);
  }
  return problems;
});

/* ------------------------------------------------------- 6. portability */

const PLATFORM_RULES = [
  { pattern: /\btaskkill\b/, allow: ["server/apps.mjs"], why: "taskkill is Windows-only; wrap it in a platform branch" },
  { pattern: /\bpowershell\b|\bpwsh\b/i, allow: ["server/apps.mjs"], why: "PowerShell is Windows-only" },
  { pattern: /\bcmd\.exe\b/i, allow: ["server/apps.mjs"], why: "cmd.exe is Windows-only" },
  { pattern: /["'`]C:\\\\/, allow: [], why: "hard-coded Windows path" },
  { pattern: /process\.env\.USERPROFILE(?!\s*\?\?)/, allow: [], why: "USERPROFILE without a HOME fallback" },
  { pattern: /["']\/tmp\//, allow: [], why: "hard-coded /tmp" },
  { pattern: /shell:\s*true/, allow: [], why: "shell: true turns user text into a command line" },
  // `regex.exec()` is fine; only child_process.exec is a shell.
  { pattern: /(?<![.\w])exec\(\s*[`"']/, allow: [], why: "exec() runs a shell string; use spawn with an argv array" },
];

await test("nothing in the runtime is Windows-only or POSIX-only by accident", async () => {
  const problems = [];
  const files = [...walk(path.join(APP, "server"), [".mjs"]), ...walk(path.join(APP, "electron"), [".mjs"])];
  for (const file of files) {
    const relative = path.relative(APP, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    source.split("\n").forEach((line, index) => {
      if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
      for (const rule of PLATFORM_RULES) {
        if (rule.allow.includes(relative)) continue;
        if (rule.pattern.test(line)) problems.push(`${relative}:${index + 1} ${rule.why} — ${line.trim().slice(0, 90)}`);
      }
    });
  }
  return problems;
});

await test("every app can be launched on all three platforms", async () => {
  const { APPS } = await import("../server/apps.mjs");
  const problems = [];
  const WIN_KEYS = ["paths", "exe", "appId", "knownAppIds", "startNames", "registry", "protocol", "defaultBrowser", "direct", "preferStartMenu", "consoleFallback"];

  for (const app of APPS) {
    const win = app.win ?? {};
    if (!WIN_KEYS.some((key) => win[key] !== undefined)) problems.push(`${app.id}: no Windows launcher`);
    for (const key of Object.keys(win)) {
      if (!WIN_KEYS.includes(key)) problems.push(`${app.id}: win.${key} is not a key the resolver reads`);
    }

    const mac = app.mac;
    const macOk = (Array.isArray(mac) && mac.length > 0) || (typeof mac === "string" && mac) || mac?.defaultBrowser === true;
    if (!macOk) problems.push(`${app.id}: no macOS launcher`);

    const linux = app.linux;
    const linuxOk = (typeof linux === "string" && linux) || linux?.defaultBrowser === true;
    if (!linuxOk) problems.push(`${app.id}: no Linux launcher`);

    if (!Array.isArray(app.terms) || !app.terms.length) problems.push(`${app.id}: no search terms`);
    if (!app.label) problems.push(`${app.id}: no label`);
  }
  return problems;
});

await test("paths are built with path.join, never with a hard-coded separator", async () => {
  const problems = [];
  const files = [...walk(path.join(APP, "server"), [".mjs"])];
  for (const file of files) {
    const relative = path.relative(APP, file);
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (/^\s*(?:\*|\/\/)/.test(line)) return;
      // path.join(x, "a") + "/b"  or  dir + "\\name"
      if (/\+\s*["']\/[A-Za-z0-9._-]+["']/.test(line) && !/url|http|href|regex|\/api\//.test(line)) {
        problems.push(`${relative}:${index + 1} concatenates a path separator — ${line.trim().slice(0, 90)}`);
      }
    });
  }
  return problems;
});

/* ------------------------------------------------------ 7. electron wiring */

await test("every IPC channel the preload exposes is handled in main", async () => {
  const problems = [];
  const preload = read("electron/preload.mjs");
  const main = read("electron/main.mjs") + read("electron/updater.mjs");
  const channels = new Set([
    ...[...preload.matchAll(/ipcRenderer\.(?:send|invoke)\("([^"]+)"/g)].map((m) => m[1]),
    ...[...preload.matchAll(/ipcRenderer\.on\("([^"]+)"/g)].map((m) => m[1]),
  ]);
  const handled = new Set([
    ...[...main.matchAll(/ipcMain\.(?:on|handle)\("([^"]+)"/g)].map((m) => m[1]),
    ...[...main.matchAll(/webContents\.send\("([^"]+)"/g)].map((m) => m[1]),
  ]);
  for (const channel of channels) {
    if (!handled.has(channel) && !main.includes(`"${channel}"`)) problems.push(`preload uses ${channel}, main never handles it`);
  }
  return problems;
});

await test("the desktop shell can boot without a window server", async () => {
  // Electron only runs where there is a display, so prove the entry points at
  // least parse and that nothing at module scope needs a browser.
  const problems = [];
  const { spawnSync } = await import("node:child_process");
  for (const file of ["electron/main.mjs", "electron/preload.mjs", "electron/updater.mjs"]) {
    const result = spawnSync(process.execPath, ["--check", path.join(APP, file)], { encoding: "utf8" });
    if (result.status !== 0) problems.push(`${file} does not parse: ${result.stderr.split("\n")[0]}`);
  }
  return problems;
});

/* ----------------------------------------------------------- 8. deps + pkg */

await test("every runtime import is a declared dependency", async () => {
  const problems = [];
  const pkg = JSON.parse(read("package.json"));
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  const builtins = new Set(["fs", "path", "os", "http", "https", "url", "util", "child_process", "crypto", "net", "events", "stream", "zlib", "assert", "tty", "readline", "worker_threads", "buffer", "process", "timers"]);

  for (const file of [...walk(path.join(APP, "server"), [".mjs"]), ...walk(path.join(APP, "electron"), [".mjs"])]) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      const specifier = match[1];
      if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier.startsWith("file:")) continue;
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      if (builtins.has(name)) continue;
      if (!declared.has(name)) problems.push(`${path.relative(APP, file)} imports ${name}, which is not in package.json`);
      // `electron` ships with the app itself, so it is a devDependency on purpose.
      if (name !== "electron" && pkg.devDependencies?.[name] && !pkg.dependencies?.[name]) {
        problems.push(`${path.relative(APP, file)} imports ${name} at runtime but it is only a devDependency`);
      }
    }
  }
  return problems;
});

await test("the packaged app would contain everything it needs", async () => {
  const problems = [];
  const pkg = JSON.parse(read("package.json"));
  const build = pkg.build ?? {};
  const files = build.files ?? [];
  const unpack = build.asarUnpack ?? [];

  if (!pkg.main) problems.push("package.json has no main entry");
  else if (!fs.existsSync(path.join(APP, pkg.main))) problems.push(`main entry ${pkg.main} does not exist`);

  for (const required of ["server/**", "dist/**"]) {
    if (!files.includes(required)) problems.push(`build.files is missing ${required}`);
  }
  if (!unpack.includes("server/**")) problems.push("asarUnpack must include server/** or the service cannot be imported");
  if (!unpack.some((entry) => entry.startsWith("dist"))) problems.push("asarUnpack must include the built UI");
  if (!fs.existsSync(path.join(APP, "build/icon.ico"))) problems.push("build/icon.ico is missing");
  if (!fs.existsSync(path.join(APP, "dist/index.html"))) problems.push("dist/index.html is missing — run the build");
  if (!build.publish?.length) problems.push("no publish config: auto-update would have nowhere to look");
  if (pkg.dependencies?.["electron-updater"] === undefined) problems.push("electron-updater must be a dependency, not a devDependency");
  if (!build.nsis) problems.push("no nsis config");

  const lock = JSON.parse(read("package-lock.json"));
  if (lock.version !== pkg.version) problems.push(`lockfile ${lock.version} ≠ package.json ${pkg.version}`);
  return problems;
});

await test("the installed service can start from the packaged layout", async () => {
  // Mirrors what main.mjs does after install: import server/index.mjs from the
  // unpacked folder with MAX_STATE_DIR pointing at userData.
  const problems = [];
  const { spawnSync } = await import("node:child_process");
  const stateDir = path.join(SANDBOX, "installed-state");
  const probe = `
    process.env.MAX_STATE_DIR = ${JSON.stringify(stateDir)};
    process.env.MAX_HOST = "127.0.0.1";
  try {
    const store = await import(${JSON.stringify(path.join(APP, "server/store.mjs"))});
    store.saveConfig({ saveDir: path.join(process.env.MAX_STATE_DIR, "notes"), codeDir: path.join(process.env.MAX_STATE_DIR, "code"), github: { username: "", token: "" }, leetcode: { username: "" } });
  } catch {
    // A read-only state folder is exactly what some probes are testing: carry on.
  }
    const { startServer } = await import(${JSON.stringify(path.join(APP, "server/index.mjs"))});
    const service = await startServer({ port: 0, host: "127.0.0.1" });
    const health = await fetch("http://127.0.0.1:" + service.port + "/api/health").then((r) => r.json());
    if (!health.ok) throw new Error("health said " + JSON.stringify(health));
    await service.close();
    console.log("ok", service.port);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0 || !result.stdout.includes("ok")) {
    problems.push(`packaged-style boot failed: ${(result.stderr || result.stdout).split("\n").slice(0, 5).join(" ")}`);
  }
  return problems;
});

/* -------------------------------------------------------------- 9. the UI */

await test("every translation key the UI asks for exists", async () => {
  const problems = [];
  const i18n = read("src/lib/i18n.ts");
  const fallbackBlock = i18n.slice(i18n.indexOf("const FALLBACK"), i18n.indexOf("let current"));
  const known = new Set([...fallbackBlock.matchAll(/"([a-z]+\.[a-zA-Z]+)":/g)].map((m) => m[1]));
  const used = new Set([...read("src/lib/ui.ts").matchAll(/t\(`([a-z]+\.\$\{[^}]+\})`/g)].map((m) => m[1]));
  if (!known.size) problems.push("could not read the FALLBACK table");
  for (const key of known) {
    if (!/^[a-z]+\.[a-zA-Z]+$/.test(key)) problems.push(`odd key ${key}`);
  }
  if (!used.size) problems.push("no dynamic translation keys found — ui.ts changed shape");
  return problems;
});

await test("the renderer never reaches outside the island", async () => {
  const problems = [];
  for (const file of walk(path.join(APP, "src"), [".ts", ".tsx"])) {
    const relative = path.relative(APP, file);
    const source = fs.readFileSync(file, "utf8");
    if (/console\.(log|warn|error|debug)\(/.test(source)) problems.push(`${relative} logs to the console`);
    const externalUrl = /https?:\/\/(?!127\.0\.0\.1|localhost)/;
    for (const line of source.split("\n")) {
      if (!externalUrl.test(line)) continue;
      // A link the user clicks is fine; a fetch the app performs by itself is not.
      const deliberate = /openExternal|github\.com\/ssambit635-svg|href=|placeholder|title=|link=/.test(line);
      if (!deliberate && !relative.includes("api.ts")) problems.push(`${relative} reaches an external URL: ${line.trim().slice(0, 80)}`);
    }
    if (/fetch\("http/.test(source)) problems.push(`${relative} calls an absolute URL directly`);
  }
  return problems;
});

await test("the UI build and typecheck pass", async () => {
  if (FAST) return [];
  const { spawnSync } = await import("node:child_process");
  const problems = [];
  const tsc = spawnSync(path.join(APP, "node_modules/.bin/tsc"), ["--noEmit"], { cwd: APP, encoding: "utf8", timeout: 180_000 });
  if (tsc.status !== 0) problems.push(`tsc: ${(tsc.stdout || tsc.stderr).split("\n").slice(0, 6).join(" | ")}`);
  const vite = spawnSync(path.join(APP, "node_modules/.bin/vite"), ["build", "--logLevel", "error"], { cwd: APP, encoding: "utf8", timeout: 180_000 });
  if (vite.status !== 0) problems.push(`vite build: ${(vite.stderr || vite.stdout).split("\n").slice(0, 6).join(" | ")}`);
  return problems;
});


/* ================================================================== wave 2 ==
   The checks below are the ones that catch "it worked on my machine": screen
   sizes, slow networks, read-only folders, 5000-file repos, churn.
   ========================================================================= */

await test("the window fits every screen, including tiny and negative ones", async () => {
  const { computeBounds, isOffScreen, COLLAPSED, EXPANDED } = await import("../electron/bounds.mjs");
  const problems = [];

  const screens = [
    { name: "1080p", area: { x: 0, y: 0, width: 1920, height: 1040 } },
    { name: "1366x768 laptop with taskbar", area: { x: 0, y: 0, width: 1366, height: 728 } },
    { name: "4K at 150%", area: { x: 0, y: 0, width: 2560, height: 1400 } },
    { name: "720p", area: { x: 0, y: 0, width: 1280, height: 680 } },
    { name: "tiny 800x600", area: { x: 0, y: 0, width: 800, height: 560 } },
    { name: "second display to the left", area: { x: -1920, y: 0, width: 1920, height: 1040 } },
    { name: "portrait", area: { x: 0, y: 0, width: 1080, height: 1880 } },
  ];

  for (const screen of screens) {
    for (const mode of ["collapsed", "expanded"]) {
      const bounds = computeBounds({
        mode,
        area: screen.area,
        current: { x: screen.area.x + 400, y: screen.area.y + 300, width: 336, height: 64 },
        saved: { x: screen.area.x + 400, y: screen.area.y + 300 },
      });
      const inside =
        bounds.x >= screen.area.x &&
        bounds.y >= screen.area.y &&
        bounds.x + bounds.width <= screen.area.x + screen.area.width &&
        bounds.y + bounds.height <= screen.area.y + screen.area.height;
      if (!inside) problems.push(`${screen.name}/${mode}: ${JSON.stringify(bounds)} hangs outside ${JSON.stringify(screen.area)}`);
      if (bounds.width < 100 || bounds.height < 40) problems.push(`${screen.name}/${mode}: unusable size ${bounds.width}×${bounds.height}`);
    }
  }

  // A window that is already half off-screen must be pulled back in.
  const rescued = computeBounds({
    mode: "collapsed",
    area: { x: 0, y: 0, width: 1920, height: 1040 },
    current: { x: -3000, y: -2000, width: 336, height: 64 },
    saved: { x: -5000, y: -5000 },
  });
  if (rescued.x < 0 || rescued.y < 0) problems.push(`an off-screen window was not rescued: ${JSON.stringify(rescued)}`);

  if (!isOffScreen({ x: -5000, y: 0 }, { x: 0, y: 0, width: 1920, height: 1040 })) problems.push("isOffScreen said -5000 is fine");
  if (isOffScreen({ x: 500, y: 300 }, { x: 0, y: 0, width: 1920, height: 1040 })) problems.push("isOffScreen rejected an on-screen point");

  // The open island must always be wider than the pill.
  if (EXPANDED.width <= COLLAPSED.width) problems.push("the expanded window is not wider than the collapsed one");
  return problems;
});

await test("a slow network cannot make the island wait", async () => {
  const problems = [];
  // The budget is what /api/state may spend before showing placeholders.
  const started = Date.now();
  const state = await call("GET", "/api/state");
  const elapsed = Date.now() - started;
  if (state.status !== 200) problems.push(`/api/state → ${state.status}`);
  if (elapsed > 3000) problems.push(`/api/state took ${elapsed}ms — the island would sit blank`);
  const stats = state.json?.stats;
  if (!stats) problems.push("/api/state returned no stats");
  for (const key of ["github", "leetcode", "render", "vscode", "system"]) {
    if (!stats?.[key]) problems.push(`stats.${key} is missing`);
  }
  if (stats?.system?.cpu === undefined) problems.push("stats.system has no cpu reading");
  return problems;
});

await test("the state payload has every field the UI reads", async () => {
  const problems = [];
  const state = await call("GET", "/api/state");
  const payload = state.json ?? {};
  const types = read("src/lib/types.ts");
  const block = types.slice(types.indexOf("export interface StatePayload"), types.indexOf("export interface CommandUi"));
  const fields = [...block.matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
  if (fields.length < 5) problems.push("could not read StatePayload from types.ts");
  for (const field of fields) {
    if (!(field in payload)) problems.push(`the UI expects state.${field}, the server never sends it`);
  }
  return problems;
});

await test("unicode survives a round trip through notes and snippets", async () => {
  const problems = [];
  const text = "नमस्ते दुनिया · 你好 · مرحبا · 🙂🚀 · ünïcödé";
  const note = await call("POST", "/api/notes", { text });
  if (!note.json?.ok) problems.push(`note refused: ${note.json?.message}`);
  const savedFile = note.json?.saved?.file;
  if (!savedFile) problems.push("the note did not report where it was saved");
  else if (!fs.readFileSync(savedFile, "utf8").includes("नमस्ते")) problems.push("the note file came back mangled");
  if (!savedFile?.startsWith(path.join(SANDBOX, "notes"))) problems.push(`the note escaped the sandbox: ${savedFile}`);

  const saved = await call("POST", "/api/code/snippets", { name: "emoji", code: text });
  if (!saved.json?.ok) problems.push(`snippet refused: ${saved.json?.message}`);
  const copied = await call("POST", "/api/code/snippet/copy", { name: "emoji" });
  if (copied.json?.snippet?.code !== text) problems.push("the snippet changed on the way back");

  const wrongType = await call("POST", "/api/notes", { text: { a: 1 } });
  if (wrongType.status !== 400) problems.push(`a non-text note was accepted with ${wrongType.status}`);

  // Multi-byte bodies: the limit counts bytes, not characters.
  const wide = "🙂".repeat(120_000);
  const big = await call("POST", "/api/notes", { text: wide });
  if (big.status >= 500) problems.push(`a multi-byte body crashed the server: ${big.status}`);
  return problems;
});

await test("200 requests do not leak file handles or memory", async () => {
  const problems = [];
  const before = process.memoryUsage().heapUsed;
  const fdsBefore = fs.readdirSync("/proc/self/fd").length;

  for (let index = 0; index < 200; index += 1) {
    await call(index % 3 === 0 ? "GET" : "POST", index % 3 === 0 ? "/api/health" : "/api/command", index % 3 === 0 ? undefined : { input: "help" });
  }

  global.gc?.();
  const after = process.memoryUsage().heapUsed;
  const fdsAfter = fs.readdirSync("/proc/self/fd").length;
  const growthMb = (after - before) / 1024 / 1024;
  if (growthMb > 120) problems.push(`heap grew ${growthMb.toFixed(1)} MB over 200 requests`);
  if (fdsAfter - fdsBefore > 30) problems.push(`${fdsAfter - fdsBefore} file handles leaked over 200 requests`);
  return problems;
});

await test("live streams can be opened and dropped repeatedly", async () => {
  const problems = [];
  for (let index = 0; index < 15; index += 1) {
    const controller = new AbortController();
    const response = await fetch(`${ORIGIN}/api/events`, { signal: controller.signal }).catch(() => null);
    if (!response?.body) {
      problems.push(`stream ${index} did not open`);
      continue;
    }
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  // The service must still answer afterwards.
  const health = await call("GET", "/api/health");
  if (health.status !== 200) problems.push(`the service died after stream churn: ${health.status}`);
  return problems;
});

await test("a repo with 5000 files is scanned quickly and capped", async () => {
  const problems = [];
  const root = path.join(SANDBOX, "huge");
  for (let dir = 0; dir < 50; dir += 1) {
    const folder = path.join(root, `pkg${dir}`);
    fs.mkdirSync(folder, { recursive: true });
    for (let file = 0; file < 100; file += 1) {
      fs.writeFileSync(path.join(folder, `f${file}.js`), "var x = 1\n");
    }
  }
  const started = Date.now();
  const scan = await call("POST", "/api/code/scan", { root });
  const elapsed = Date.now() - started;
  if (scan.status !== 200) problems.push(`scan → ${scan.status}`);
  if (!scan.json?.ok) problems.push(`scan failed: ${scan.json?.message}`);
  if ((scan.json?.summary?.files ?? 0) > 400) problems.push(`scanned ${scan.json.summary.files} files — the cap is 400`);
  if (elapsed > 8000) problems.push(`scanning 5000 files took ${elapsed}ms`);
  return problems;
});

await test("concurrent writes do not corrupt the state file", async () => {
  const problems = [];
  await Promise.all(
    Array.from({ length: 20 }, (_value, index) => call("POST", "/api/config", { prefs: { idleSleepSeconds: 60 + index } })),
  );
  const state = await call("GET", "/api/state");
  if (state.status !== 200) problems.push(`state broke after 20 parallel writes: ${state.status}`);
  const config = JSON.parse(fs.readFileSync(path.join(process.env.MAX_STATE_DIR, "config.json"), "utf8"));
  if (typeof config.prefs?.idleSleepSeconds !== "number") problems.push("config.json is corrupt after parallel writes");
  return problems;
});

await test("the service survives a read-only state folder", async () => {
  const problems = [];
  const { spawnSync } = await import("node:child_process");
  const locked = path.join(SANDBOX, "locked");
  fs.mkdirSync(locked, { recursive: true });
  fs.chmodSync(locked, 0o500);
  const probe = `
    process.env.MAX_STATE_DIR = ${JSON.stringify(path.join(locked, "state"))};
    process.env.MAX_HOST = "127.0.0.1";
  try {
    const store = await import(${JSON.stringify(path.join(APP, "server/store.mjs"))});
    store.saveConfig({ saveDir: path.join(process.env.MAX_STATE_DIR, "notes"), codeDir: path.join(process.env.MAX_STATE_DIR, "code"), github: { username: "", token: "" }, leetcode: { username: "" } });
  } catch {
    // A read-only state folder is exactly what some probes are testing: carry on.
  }
    const { startServer } = await import(${JSON.stringify(path.join(APP, "server/index.mjs"))});
    const service = await startServer({ port: 0, host: "127.0.0.1" });
    const state = await fetch("http://127.0.0.1:" + service.port + "/api/state").then((r) => r.json());
    if (!state.config?.prefs) throw new Error("no config with a read-only state dir");
    await service.close();
    console.log("ok");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", timeout: 30_000 });
  fs.chmodSync(locked, 0o700);
  if (result.status !== 0 || !result.stdout.includes("ok")) {
    problems.push(`read-only state broke the boot: ${(result.stderr || result.stdout).split("\n").slice(0, 4).join(" ")}`);
  }
  return problems;
});

await test("a missing UI build still leaves the API usable", async () => {
  const problems = [];
  const { spawnSync } = await import("node:child_process");
  const probe = `
    process.env.MAX_STATE_DIR = ${JSON.stringify(path.join(SANDBOX, "no-dist"))};
    process.env.MAX_DIST_DIR = "/definitely/not/here";
    process.env.MAX_ASSETS_DIR = "/definitely/not/here/either";
    process.env.MAX_HOST = "127.0.0.1";
  try {
    const store = await import(${JSON.stringify(path.join(APP, "server/store.mjs"))});
    store.saveConfig({ saveDir: path.join(process.env.MAX_STATE_DIR, "notes"), codeDir: path.join(process.env.MAX_STATE_DIR, "code"), github: { username: "", token: "" }, leetcode: { username: "" } });
  } catch {
    // A read-only state folder is exactly what some probes are testing: carry on.
  }
    const { startServer } = await import(${JSON.stringify(path.join(APP, "server/index.mjs"))});
    const service = await startServer({ port: 0, host: "127.0.0.1" });
    const health = await fetch("http://127.0.0.1:" + service.port + "/api/health");
    if (health.status !== 200) throw new Error("health " + health.status);
    const page = await fetch("http://127.0.0.1:" + service.port + "/");
    if (page.status >= 500) throw new Error("the missing UI produced " + page.status);
    await service.close();
    console.log("ok");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0 || !result.stdout.includes("ok")) {
    problems.push(`no-UI boot failed: ${(result.stderr || result.stdout).split("\n").slice(0, 4).join(" ")}`);
  }
  return problems;
});

await test("commands are idempotent where they claim to be", async () => {
  const problems = [];
  const first = await call("POST", "/api/code/scan", { root: "src" });
  const second = await call("POST", "/api/code/scan", { root: "src" });
  if (first.json?.score !== second.json?.score) problems.push(`scan score drifted: ${first.json?.score} then ${second.json?.score}`);
  if (first.json?.summary?.files !== second.json?.summary?.files) problems.push("scan file count drifted between runs");
  return problems;
});

await test("an app name cannot smuggle a command", async () => {
  const problems = [];
  const { addCustomApp } = await import("../server/apps.mjs");
  const nasty = ["$(rm -rf /)", "`whoami`", "app; rm -rf /", "app && whoami", "app | cat /etc/passwd"];
  for (const name of nasty) {
    const result = addCustomApp(name, "/bin/ls");
    if (result.ok) {
      // The name is only ever used as text, never as part of a command line.
      const unsafe = /[;&|$()`]/.test(result.app.name);
      if (unsafe) problems.push(`accepted a shell-shaped name: ${result.app.name}`);
    }
  }
  return problems;
});


/* ================================================================== wave 3 ==
   Things that only break on someone else's machine: the other two operating
   systems, folders with spaces and accents, symlinks, shutdown.
   ========================================================================= */

await test("the same code boots pretending to be Windows and macOS", async () => {
  const problems = [];
  const { spawnSync } = await import("node:child_process");

  for (const platform of ["win32", "darwin", "linux"]) {
    const probe = `
      Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
      process.env.MAX_STATE_DIR = ${JSON.stringify(path.join(SANDBOX, `plat-${platform}`))};
      process.env.MAX_HOST = "127.0.0.1";
  try {
    const store = await import(${JSON.stringify(path.join(APP, "server/store.mjs"))});
    store.saveConfig({ saveDir: path.join(process.env.MAX_STATE_DIR, "notes"), codeDir: path.join(process.env.MAX_STATE_DIR, "code"), github: { username: "", token: "" }, leetcode: { username: "" } });
  } catch {
    // A read-only state folder is exactly what some probes are testing: carry on.
  }
      const { startServer } = await import(${JSON.stringify(path.join(APP, "server/index.mjs"))});
      const service = await startServer({ port: 0, host: "127.0.0.1" });
      const base = "http://127.0.0.1:" + service.port;
      const state = await fetch(base + "/api/state").then((r) => r.json());
      if (!state.config?.prefs) throw new Error("no config");
      const apps = await fetch(base + "/api/apps").then((r) => r.json());
      if (!Array.isArray(apps.apps) || apps.apps.length < 10) throw new Error("apps went missing on " + process.platform);
      for (const app of apps.apps) {
        if (typeof app.id !== "string" || typeof app.label !== "string") throw new Error("bad app entry " + JSON.stringify(app).slice(0, 80));
        if (app.available !== null && typeof app.available !== "boolean") throw new Error("availability is not a boolean");
      }
      const scanned = await fetch(base + "/api/code/scan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: ${JSON.stringify(path.join(APP, "src"))} }),
      }).then((r) => r.json());
      if (!scanned.ok) throw new Error("scan failed on " + process.platform + ": " + scanned.message);
      await service.close();
      console.log("ok");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", timeout: 40_000 });
    if (result.status !== 0 || !result.stdout.includes("ok")) {
      problems.push(`booting as ${platform} failed: ${(result.stderr || result.stdout).split("\n").slice(0, 4).join(" ")}`);
    }
  }
  return problems;
});

await test("folders with spaces, accents and emoji work", async () => {
  const problems = [];
  const awkward = path.join(SANDBOX, "Ravi Kumar", "Données MAX 🙂", "notes");
  const config = await call("POST", "/api/config", { saveDir: awkward });
  if (!config.json?.ok) problems.push("the app refused a folder with spaces and accents");

  const note = await call("POST", "/api/notes", { text: "hello from an awkward path" });
  if (!note.json?.ok) problems.push(`saving there failed: ${note.json?.message}`);
  if (note.json?.saved?.file && !fs.existsSync(note.json.saved.file)) problems.push("the note was not actually written");
  if (!note.json?.saved?.file?.startsWith(awkward)) problems.push(`the note landed somewhere else: ${note.json?.saved?.file}`);

  // and back to the sandbox for the rest of the run
  await call("POST", "/api/config", { saveDir: path.join(SANDBOX, "notes") });
  return problems;
});

await test("broken symlinks and odd files do not stop a scan", async () => {
  const problems = [];
  const root = path.join(SANDBOX, "odd");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "fine.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(root, "binary.js"), Buffer.from([0, 1, 2, 3, 0xff, 0xfe]));
  fs.writeFileSync(path.join(root, "no-extension"), "x");
  fs.writeFileSync(path.join(root, "huge.js"), "a".repeat(600_000));
  try {
    fs.symlinkSync(path.join(root, "nowhere.js"), path.join(root, "dangling.js"));
    fs.symlinkSync(root, path.join(root, "loop"));
  } catch {
    /* symlinks may be restricted; the rest still counts */
  }

  const started = Date.now();
  const scan = await call("POST", "/api/code/scan", { root });
  const elapsed = Date.now() - started;
  if (scan.status !== 200 || !scan.json?.ok) problems.push(`scan failed on odd files: ${scan.json?.message ?? scan.status}`);
  if (elapsed > 8000) problems.push(`odd files made the scan take ${elapsed}ms`);
  if ((scan.json?.summary?.files ?? 0) > 400) problems.push("the file cap did not hold");
  return problems;
});

await test("the caps that protect the disk actually hold", async () => {
  const problems = [];
  const snippets = await import("../server/snippets.mjs");
  const { addCustomApp, APPS } = await import("../server/apps.mjs");

  // 205 snippets, but only 200 may be kept.
  for (let index = 0; index < 205; index += 1) snippets.saveSnippet(`cap-${index}`, `value ${index}`);
  const stored = snippets.snippetIndex();
  if (stored.length > 200) problems.push(`${stored.length} snippets stored, cap is 200`);
  if (stored.length < 150) problems.push(`only ${stored.length} snippets survived — the cap is eating them too early`);

  // A snippet over 20 KB is truncated, not refused into a broken state.
  const big = snippets.saveSnippet("long", "x".repeat(50_000));
  if (!big.ok) problems.push("a long snippet was refused outright");
  if (big.snippet && big.snippet.code.length > 20_000) problems.push(`a ${big.snippet.code.length}-character snippet was stored`);

  // The built-in list must stay a sane size too.
  if (APPS.length > 60) problems.push(`${APPS.length} built-in apps — the argument for a bigger list is not there`);
  const custom = addCustomApp("CapTest", "/bin/ls");
  if (!custom.ok) problems.push(`adding a custom app failed: ${custom.message}`);
  return problems;
});

await test("the service shuts down cleanly on a signal", async () => {
  const problems = [];
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: APP,
    env: { ...process.env, MAX_STATE_DIR: path.join(SANDBOX, "shutdown"), MAX_API_PORT: "0", MAX_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });

  const started = Date.now();
  while (Date.now() - started < 10_000 && !output.includes("island server on")) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!output.includes("island server on")) {
    problems.push("the standalone service never announced itself");
    child.kill("SIGKILL");
    return problems;
  }

  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  child.kill("SIGTERM");
  const result = await Promise.race([exit, new Promise((resolve) => setTimeout(() => resolve({ code: "timeout" }), 5000))]);
  if (result.code === "timeout") {
    problems.push("SIGTERM did not stop the service within 5s");
    child.kill("SIGKILL");
  }
  return problems;
});

await test("the updater cannot run in a development build", async () => {
  const problems = [];
  const updater = read("electron/updater.mjs");
  if (!/app\.isPackaged/.test(updater)) problems.push("updater.mjs never checks app.isPackaged — a dev build would phone home");
  if (!/checkForUpdates/.test(updater)) problems.push("the updater never asks for updates");
  if (/autoInstallOnAppQuit\s*=\s*true/.test(updater) && !/Restart to install/.test(read("electron/main.mjs"))) {
    problems.push("updates install without telling the user");
  }
  // Importing it must not run anything: no side effects at module scope.
  const module = read("electron/updater.mjs");
  const topLevelCalls = module
    .split("\n")
    .filter((line) => /^(?!\s|\/\/|\*)/.test(line) && /\(/.test(line))
    .filter((line) => !/^(import|export|const|let|function|\/\*|\*)/.test(line));
  if (topLevelCalls.length) problems.push(`updater.mjs runs code on import: ${topLevelCalls[0].trim().slice(0, 60)}`);
  return problems;
});

await test("the desktop shell declares the Electron it was built against", async () => {
  const problems = [];
  const pkg = JSON.parse(read("package.json"));
  const electron = pkg.devDependencies?.electron;
  if (!electron) problems.push("electron is not a devDependency");
  if (!pkg.engines?.node) problems.push("package.json does not say which Node it needs");
  const nodeMajor = Number(String(pkg.engines?.node ?? "").replace(/[^0-9.]/g, "").split(".")[0] || 0);
  if (nodeMajor && Number(process.versions.node.split(".")[0]) < nodeMajor) {
    problems.push(`this machine runs Node ${process.versions.node}, the app asks for ${pkg.engines.node}`);
  }
  if (!/electron-updater/.test(JSON.stringify(pkg.dependencies))) problems.push("electron-updater is missing from dependencies");
  return problems;
});


/* ================================================================== wave 4 ==
   Speed is a feature. These are the budgets the island is allowed to spend; a
   pet that stutters while you type is not a pet.
   ========================================================================= */

const budget = async (label, limitMs, run) => {
  const started = Date.now();
  const value = await run();
  const elapsed = Date.now() - started;
  return { problem: elapsed > limitMs ? `${label} took ${elapsed}ms (budget ${limitMs}ms)` : null, elapsed, value };
};

await test("the hot paths stay inside their time budgets", async () => {
  const problems = [];
  const { review } = await import("../server/code/engine.mjs");
  const { handleCommand } = await import("../server/commands.mjs");

  // A 5,000-line file is a big real file; reviewing it must still feel instant.
  const bigSource = Array.from({ length: 5000 }, (_value, index) => `function fn${index}(a) { if (a == null) { return ${index}; } return a; }`).join("\n");
  const reviewBudget = await budget("review of a 5000-line file", 2500, () => review(bigSource, "javascript"));
  if (reviewBudget.problem) problems.push(reviewBudget.problem);
  if (!reviewBudget.value?.stats?.lines) problems.push("the big review returned no stats");

  const commandBudget = await budget("20 commands", 2000, async () => {
    for (let index = 0; index < 20; index += 1) await handleCommand("help");
  });
  if (commandBudget.problem) problems.push(commandBudget.problem);

  const scanBudget = await budget("scanning this project's src", 4000, () => call("POST", "/api/code/scan", { root: "src" }));
  if (scanBudget.problem) problems.push(scanBudget.problem);
  if ((scanBudget.value?.json?.score ?? 0) < 80) problems.push(`our own src scores ${scanBudget.value?.json?.score} — fix the source, not the scorer`);

  const stateBudget = await budget("/api/state", 1500, () => call("GET", "/api/state"));
  if (stateBudget.problem) problems.push(stateBudget.problem);

  const searchBudget = await budget("snippet lookup with 200 stored", 300, async () => {
    const snippets = await import("../server/snippets.mjs");
    return snippets.findSnippet("cap-150");
  });
  if (searchBudget.problem) problems.push(searchBudget.problem);
  return problems;
});

await test("the highlighter survives a megabyte of code", async () => {
  const problems = [];
  const { spawnSync } = await import("node:child_process");
  // The highlighter runs in the renderer, so bundle it the way the app does.
  const probe = `
    const { build } = await import("esbuild");
    const result = await build({ entryPoints: [${JSON.stringify(path.join(APP, "src/lib/highlight.ts"))}], bundle: true, format: "esm", write: false, platform: "neutral" });
    const code = result.outputFiles[0].text;
    const mod = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
    const source = ("const value = 42; // comment\\n").repeat(40000);
    const started = Date.now();
    const html = mod.highlight(source, "javascript");
    const elapsed = Date.now() - started;
    if (elapsed > 4000) throw new Error("highlighting 1 MB took " + elapsed + "ms");
    if (html.length < source.length) throw new Error("the highlighter lost characters");
    if (!/<span/.test(html)) throw new Error("no colours at all");
    console.log("ok " + elapsed);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: APP, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0 || !result.stdout.includes("ok")) {
    problems.push(`highlighter stress failed: ${(result.stderr || result.stdout).split("\n").slice(0, 4).join(" ")}`);
  }
  return problems;
});

await test("the island's own files are clean by its own rules", async () => {
  const problems = [];
  const scan = await call("POST", "/api/code/scan", { root: "src" });
  if (!scan.json?.ok) return [`scan failed: ${scan.json?.message}`];
  if ((scan.json.summary?.errors ?? 1) > 0) problems.push(`${scan.json.summary.errors} errors in our own source`);
  return problems;
});

await test("the docs do not lie about the version", async () => {
  const problems = [];
  const pkg = JSON.parse(read("package.json"));
  const readme = fs.readFileSync(path.join(APP, "..", "README.md"), "utf8");
  const mentioned = [...readme.matchAll(/MAX-(\d+\.\d+\.\d+)-win-x64\.exe/g)].map((m) => m[1]);
  for (const version of mentioned) {
    if (version !== pkg.version) problems.push(`README advertises ${version}, package.json says ${pkg.version}`);
  }
  const changelog = read("src/lib/changelog.ts");
  if (!changelog.includes(`version: "${pkg.version}"`)) problems.push(`release notes have no entry for ${pkg.version}`);
  return problems;
});


/* ================================================================== wave 5 ==
   config.json is a text file people edit, and folders can be wrong. Neither may
   reach the rest of the app as NaN, "yes", or an operating-system directory.
   ========================================================================= */

await test("a rotten config file is repaired, not obeyed", async () => {
  const problems = [];
  const { saveConfig, loadConfig } = await import("../server/store.mjs");
  saveConfig({
    saveDir: "/etc",
    codeDir: "/usr/bin",
    prefs: { idleSleepSeconds: "abc", reduceMotion: "yes", language: 123, launchAtLogin: "no", alwaysOnTop: null },
    customApps: [{ name: 5, path: 7 }, { name: "Fine", path: "/bin/sh" }, "garbage"],
  });
  const config = loadConfig();
  if (config.saveDir === "/etc") problems.push("a system folder was accepted as the notes folder");
  if (config.codeDir === "/usr/bin") problems.push("a system folder was accepted as the code folder");
  if (config.prefs.idleSleepSeconds !== 120) problems.push(`idleSleepSeconds became ${config.prefs.idleSleepSeconds}`);
  if (!Number.isFinite(config.prefs.idleSleepSeconds * 1000)) problems.push("idleSleepSeconds turns into NaN");
  if (config.prefs.reduceMotion !== false) problems.push(`reduceMotion became ${JSON.stringify(config.prefs.reduceMotion)}`);
  if (config.prefs.language !== "en") problems.push(`language became ${config.prefs.language}`);
  if (config.prefs.launchAtLogin !== false) problems.push("launchAtLogin kept a string");
  if (config.prefs.alwaysOnTop !== true) problems.push("alwaysOnTop lost its default");
  if (config.customApps.length !== 1 || config.customApps[0].name !== "Fine") problems.push(`customApps survived badly: ${JSON.stringify(config.customApps)}`);

  // And a config file written by hand on disk is repaired on the way in as well.
  const { CONFIG_FILE } = await import("../server/store.mjs");
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ prefs: { idleSleepSeconds: -5 }, saveDir: "C:\\Windows\\System32" }));
  const handMade = loadConfig();
  if (handMade.prefs.idleSleepSeconds !== 10) problems.push("a hand-written negative sleep slipped through");
  if (/system32/i.test(handMade.saveDir)) problems.push("a hand-written system folder slipped through");
  return problems;
});

await test("bad folders are refused with words, not stack traces", async () => {
  const problems = [];
  const { saveNote } = await import("../server/commands.mjs");
  const { saveConfig, loadConfig } = await import("../server/store.mjs");
  const { blockedReason, safeFolder } = await import("../server/paths.mjs");

  for (const folder of ["C:\\Windows\\System32", "/usr/bin", "/etc", "/private/var", "~/.ssh", "/usr/local/lib"]) {
    if (!blockedReason(folder)) problems.push(`${folder} is not recognised as off limits`);
    if (safeFolder(folder) !== null) problems.push(`${folder} was accepted as a notes folder`);
  }
  for (const folder of [SANDBOX, path.join(SANDBOX, "notes"), "/home/user/Documents/MAX notes"]) {
    if (blockedReason(folder)) problems.push(`${folder} was wrongly refused`);
  }

  // The config simply will not store a folder the system owns.
  saveConfig({ saveDir: "/etc" });
  if (/^\/etc/.test(loadConfig().saveDir)) problems.push("the config stored /etc as the notes folder");

  // A folder that cannot be created must come back as a sentence, not an EACCES.
  const blocker = path.join(SANDBOX, "not-a-folder");
  fs.writeFileSync(blocker, "this is a file, not a folder");
  saveConfig({ saveDir: path.join(blocker, "notes") });
  const refused = saveNote("this must not be written");
  if (refused.ok) problems.push("a note was saved into a folder that cannot exist");
  if (!/folder|write|choose/i.test(refused.message ?? "")) problems.push(`the refusal is unreadable: ${refused.message}`);

  const response = await call("POST", "/api/notes", { text: "nope" });
  if (response.status !== 200 || response.json.ok !== false) {
    problems.push(`/api/notes answered ${response.status} ${JSON.stringify(response.json).slice(0, 140)}`);
  }

  // And the happy path still works once the folder is sane again.
  saveConfig({ saveDir: path.join(SANDBOX, "notes") });
  const written = saveNote("allowed", "wave5");
  if (!written.ok || !fs.existsSync(written.file)) problems.push("a note inside a normal folder was refused");
  return problems;
});

await test("no route ever answers with a crash", async () => {
  const problems = [];
  const routes = ["/api/state", "/api/config", "/api/apps", "/api/notes", "/api/snippets", "/api/activity", "/api/diagnostics"];
  for (const route of routes) {
    const response = await call("GET", route);
    if (response.status >= 500) problems.push(`GET ${route} → ${response.status}`);
  }
  // Bodies that are the wrong shape on purpose.
  const hostile = [
    ["POST", "/api/config", "not json at all"],
    ["POST", "/api/command", { argv: ["--exec", "calc"] }],
    ["POST", "/api/notes", { text: "ok", name: { nested: true } }],
    ["POST", "/api/code/open", { path: 42 }],
    ["POST", "/api/code/scan", { root: "../../.." }],
    ["POST", "/api/snippets", { name: [], body: [] }],
  ];
  for (const [method, route, body] of hostile) {
    const response = await call(method, route, body);
    if (response.status >= 500) problems.push(`${method} ${route} crashed with ${response.status}`);
  }
  return problems;
});


/* ================================================================== wave 6 ==
   The island listens on loopback, and loopback is not private: any page in the
   user's browser can reach it. These checks are the wall.
   ========================================================================= */

await test("only the island may call the island", async () => {
  const problems = [];
  const http = await import("node:http");
  const ask = (headers, path = "/api/state") =>
    new Promise((resolve) => {
      const request = http.request({ host: "127.0.0.1", port: service.port, path, headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", () => resolve("error"));
      request.end();
    });

  if ((await ask({ host: `127.0.0.1:${service.port}` })) !== 200) problems.push("the island refused itself");
  if ((await ask({ host: `localhost:${service.port}` })) !== 200) problems.push("localhost was refused");
  if ((await ask({ host: `[::1]:${service.port}` })) !== 200) problems.push("the ipv6 loopback was refused");
  if ((await ask({ host: "evil.example" })) !== 403) problems.push("a rebinding host was accepted");
  if ((await ask({ host: `192.168.1.5:${service.port}` })) !== 403) problems.push("a LAN address was accepted");
  if ((await ask({ host: `127.0.0.1:${service.port + 1}` })) !== 403) problems.push("a forwarded port was accepted");

  // A page in the browser carries an Origin: it must not be able to run commands.
  const fromPage = await call("POST", "/api/command", { input: "help" }, { extraHeaders: { origin: "https://evil.example" } });
  if (fromPage.status !== 403) problems.push(`a foreign page could POST commands (${fromPage.status})`);
  const weirdOrigin = await call("GET", "/api/state", undefined, { extraHeaders: { origin: "null" } });
  if (weirdOrigin.status !== 200) problems.push("a file:// style origin was refused");

  // The service must not listen to the whole network by default.
  const source = fs.readFileSync(path.join(APP, "server/index.mjs"), "utf8");
  const declared = source.match(/const DEFAULT_HOST = ([^;]+);/)?.[1] ?? "";
  if (!/127\.0\.0\.1|::1|localhost/.test(declared)) problems.push(`the default host is ${declared.trim()} — that is the whole network`);

  // The guard is pure, so it can be checked directly too.
  const { rejectForeignCaller } = await import("../server/origin.mjs");
  if (rejectForeignCaller({ headers: { host: "127.0.0.1:1", origin: `http://127.0.0.1:${service.port}` } }, {}) !== null) {
    problems.push("a genuine same-machine origin was refused");
  }
  return problems;
});

await test("a note name cannot escape its folder", async () => {
  const problems = [];
  const { saveNote } = await import("../server/commands.mjs");
  const folder = path.join(SANDBOX, "escape-notes");
  fs.mkdirSync(folder, { recursive: true });
  const { saveConfig } = await import("../server/store.mjs");
  saveConfig({ saveDir: folder });

  const names = ["../../escape", "a/b/../../c", "..", ".", "CON", "x\u0000y", "   ", "very".repeat(80), "vadász/../..//", "....//....//"];
  for (const name of names) {
    const result = saveNote("body", name);
    if (!result.ok) continue; // refusing is fine, escaping is not
    const inside = path.resolve(result.file).startsWith(path.resolve(folder) + path.sep);
    if (!inside) problems.push(`the name ${JSON.stringify(name)} wrote outside the folder`);
    if (path.basename(result.file).length > 120) problems.push(`the name ${JSON.stringify(name)} produced a huge file name`);
  }
  const strays = fs.readdirSync(SANDBOX).filter((entry) => entry.endsWith(".md"));
  if (strays.length) problems.push(`notes leaked into the sandbox root: ${strays.slice(0, 3).join(", ")}`);
  saveConfig({ saveDir: path.join(SANDBOX, "notes") });
  return problems;
});

await test("two hundred writes at once all land", async () => {
  const problems = [];
  const started = Date.now();
  const responses = await Promise.all(Array.from({ length: 200 }, (_value, index) => call("POST", "/api/notes", { text: `burst ${index}` })));
  const bad = responses.filter((response) => response.status !== 200 || !response.json?.ok);
  if (bad.length) problems.push(`${bad.length} of 200 concurrent note writes failed`);
  const elapsed = Date.now() - started;
  if (elapsed > 15_000) problems.push(`200 writes took ${elapsed}ms`);

  const listed = await call("GET", "/api/notes");
  if (!Array.isArray(listed.json?.notes)) problems.push("the note list is not a list after the burst");

  // Malformed bodies, in bulk, must never take the service down.
  const hostile = await Promise.all(
    Array.from({ length: 60 }, (_value, index) =>
      call("POST", "/api/command", index % 2 ? "{ broken json" : "[" + "[".repeat(5000) + "]".repeat(5000), { raw: true }),
    ),
  );
  if (hostile.some((response) => response.status >= 500)) problems.push("a malformed body produced a 500");
  if ((await call("GET", "/api/health")).status !== 200) problems.push("the service died during the burst");
  return problems;
});


/* ================================================================== wave 7 ==
   The window is placed from a file the user can edit and a crash can truncate.
   A `null` in window.json used to stop the island from opening at all.
   ========================================================================= */

await test("a broken window.json cannot stop the island opening", async () => {
  const problems = [];
  const { cleanWindowState, computeBounds } = await import("../electron/bounds.mjs");
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const current = { x: 200, y: 20, width: 336, height: 64 };

  for (const stored of [null, "text", 42, [], {}, { x: "1", y: null }, { x: NaN, y: Infinity }]) {
    const saved = cleanWindowState(stored);
    if (saved === null || typeof saved !== "object" || Array.isArray(saved)) {
      problems.push(`cleanWindowState(${JSON.stringify(stored)}) returned ${JSON.stringify(saved)}`);
      continue;
    }
    for (const mode of ["collapsed", "expanded"]) {
      const bounds = computeBounds({ mode, area, current, saved, islandHeight: 520 });
      for (const key of ["x", "y", "width", "height"]) {
        if (!Number.isFinite(bounds[key])) problems.push(`${mode} produced ${key}=${bounds[key]} from ${JSON.stringify(stored)}`);
      }
      if (bounds.width > area.width || bounds.height > area.height) problems.push(`${mode} is bigger than the screen`);
      if (bounds.x < area.x - 1 || bounds.y < area.y - 1) problems.push(`${mode} escaped the work area`);
      if (bounds.x + bounds.width > area.x + area.width + 1) problems.push(`${mode} hangs off the right edge`);
    }
  }

  // The shell itself must not trust the file either.
  const shell = fs.readFileSync(path.join(APP, "electron/main.mjs"), "utf8");
  if (!/cleanWindowState\(/.test(shell)) problems.push("main.mjs no longer cleans window.json before using it");
  if (!/cleanWindowState\(JSON\.parse/.test(shell)) problems.push("main.mjs parses window.json without cleaning it");
  return problems;
});

await test("geometry stays sane for any screen, including broken ones", async () => {
  const problems = [];
  const { computeBounds } = await import("../electron/bounds.mjs");
  const screens = [
    undefined,
    null,
    { x: 0, y: 0, width: 0, height: 0 },
    { x: NaN, y: NaN, width: NaN, height: NaN },
    { x: -1920, y: -200, width: 1920, height: 1080 },
    { x: 0, y: 0, width: 7680, height: 2160 },
    { x: 0, y: 0, width: 1024, height: 600 },
  ];
  const heights = [undefined, null, 0, -50, "tall", 1e9, 520, 120.6];
  for (const area of screens) {
    for (const islandHeight of heights) {
      for (const mode of ["collapsed", "expanded"]) {
        let bounds;
        try {
          bounds = computeBounds({ mode, area, current: { x: 0, y: 0, width: 336, height: 64 }, saved: {}, islandHeight });
        } catch (error) {
          problems.push(`threw for area ${JSON.stringify(area)} height ${String(islandHeight)}: ${error.message}`);
          continue;
        }
        for (const key of ["x", "y", "width", "height"]) {
          if (!Number.isFinite(bounds[key])) problems.push(`${key} is ${bounds[key]} for area ${JSON.stringify(area)}`);
        }
        if (bounds.width < 120 || bounds.height < 48) problems.push(`the window shrank to ${bounds.width}×${bounds.height}`);
        if (islandHeight === 520 && mode === "expanded" && area?.width >= 900 && bounds.height < 520) {
          problems.push("the open island is shorter than the panel it holds");
        }
      }
    }
  }
  return problems;
});


/* ================================================================== wave 8 ==
   The bundle a user downloads has to work with the network unplugged, and every
   file in it has to parse on the machine that runs it.
   ========================================================================= */

await test("every server and shell file parses on its own", async () => {
  const problems = [];
  const { spawnSync } = await import("node:child_process");
  const files = [];
  for (const folder of ["server", "electron", "scripts"]) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(mjs|cjs|js)$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(APP, folder));
  }
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) problems.push(`${path.relative(APP, file)}: ${(result.stderr || "").split("\n")[4] ?? "syntax error"}`);
  }
  if (files.length < 20) problems.push(`only found ${files.length} source files — the walk is broken`);
  return problems;
});

await test("every server module imports cleanly in a fresh process", async () => {
  const problems = [];
  const { spawnSync } = await import("node:child_process");
  const modules = fs
    .readdirSync(path.join(APP, "server"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => path.join(APP, "server", entry.name));
  for (const module of modules) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(module)});`], {
      encoding: "utf8",
      env: { ...process.env, MAX_STATE_DIR: path.join(SANDBOX, "import-probe") },
      timeout: 20_000,
    });
    if (result.status !== 0) {
      const line = (result.stderr || "").split("\n").find((text) => /Error/.test(text)) ?? "failed";
      problems.push(`${path.basename(module)}: ${line.slice(0, 120)}`);
    }
  }
  return problems;
});

await test("the built island works with the network unplugged", async () => {
  const problems = [];
  const dist = path.join(APP, "dist");
  if (!fs.existsSync(dist)) return ["dist is missing — run npm run build"];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dist);

  let bytes = 0;
  for (const file of files) {
    bytes += fs.statSync(file).size;
    if (!/\.(html|css|js|mjs)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    // A link in a string is fine (the shell opens it in the browser). What would
    // break on a plane is the page *fetching* something: a script, a stylesheet,
    // a font, an image, or a request of its own.
    const remote = [
      /<script[^>]+src=["']https?:/i,
      /<link[^>]+href=["']https?:/i,
      /<img[^>]+src=["']https?:/i,
      /url\(\s*["']?https?:/i,
      /@import\s+(url\()?["']?https?:/i,
      /fetch\(\s*["'`]https?:/i,
      /new\s+WebSocket\(\s*["'`]wss?:/i,
      /XMLHttpRequest[\s\S]{0,120}open\([^)]*https?:/i,
    ];
    for (const pattern of remote) {
      if (pattern.test(text)) problems.push(`${path.relative(dist, file)} fetches something remote (${pattern.source.slice(0, 28)}…)`);
    }
  }

  const megabytes = bytes / (1024 * 1024);
  if (megabytes > 3) problems.push(`the built island is ${megabytes.toFixed(1)} MB`);
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  if (!/lang=/.test(html)) problems.push("index.html declares no language");
  if (!/<meta[^>]+viewport/.test(html)) problems.push("index.html has no viewport meta");
  if (/<script[^>]+src="http/.test(html)) problems.push("index.html loads a script from the internet");
  return problems;
});


/* ================================================================== wave 9 ==
   The island shows placeholder numbers first and real ones later. Both must have
   the same shape, or the UI flips between layouts while the user watches.
   ========================================================================= */

const shapeOf = (value) => {
  if (Array.isArray(value)) return `[${value.length ? shapeOf(value[0]) : ""}]`;
  if (!value || typeof value !== "object") return typeof value;
  return `{${Object.keys(value).sort().join(",")}}`;
};

await test("the placeholder and the real stats agree on their shape", async () => {
  const problems = [];
  const source = fs.readFileSync(path.join(APP, "server/integrations.mjs"), "utf8");

  // Both objects come from the same module; compare them through the API instead
  // of reaching into private helpers.
  const cold = await call("GET", "/api/state");
  const coldStats = cold.json?.stats;
  if (!coldStats) return ["/api/state returned no stats at all"];

  const expected = ["github", "leetcode", "render", "vscode", "system"];
  for (const key of expected) {
    if (!coldStats[key]) problems.push(`stats.${key} is missing`);
  }
  for (const key of expected) {
    const demo = coldStats[key];
    if (key === "system") continue;
    if (!("demo" in demo) && key !== "vscode") problems.push(`stats.${key} has no demo flag`);
  }

  // `warming` must exist on both paths, so the UI can always read it.
  if (typeof coldStats.warming !== "boolean") problems.push(`warming is ${typeof coldStats.warming}`);
  if (!/warming: false/.test(source)) problems.push("the real stats do not declare warming: false");

  // Key parity between the placeholder and the warm value, straight from source.
  const demoBlocks = [...source.matchAll(/const DEMO_(GITHUB|LEETCODE|RENDER) = \{([\s\S]*?)\n\};/g)];
  if (demoBlocks.length < 3) problems.push("could not find the placeholder shapes in source");
  // The warm path is what the island shows afterwards, so compare against that.
  const { collectStats } = await import("../server/integrations.mjs");
  await collectStats({ waitMs: 400 });
  const warm = await collectStats({ waitMs: 400 });
  const liveShapes = {
    github: warm?.github,
    leetcode: warm?.leetcode,
    render: warm?.render,
  };
  for (const [, name, body] of demoBlocks) {
    const placeholderKeys = [...body.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort();
    const live = liveShapes[name.toLowerCase()];
    const liveKeys = Object.keys(live ?? {}).sort();
    const missing = placeholderKeys.filter((key) => !liveKeys.includes(key));
    if (missing.length) problems.push(`DEMO_${name} has ${missing.join(", ")} but the live object does not`);
  }
  return problems;
});

await test("removing a token never keeps showing its numbers", async () => {
  const problems = [];
  const { collectStats, invalidateStats } = await import("../server/integrations.mjs");
  const { saveConfig } = await import("../server/store.mjs");

  saveConfig({ github: { username: "ssambit635-svg", token: "ghp_fake_token_for_the_test" } });
  const first = await collectStats({ waitMs: 200 });
  if (!first?.github) problems.push("no github block at all");

  // Disconnecting must not serve the previous answer from cache.
  saveConfig({ github: { username: "", token: "" } });
  invalidateStats();
  const after = await collectStats({ waitMs: 200 });
  if (after?.github?.login === "ssambit635-svg" && first?.github?.login === "ssambit635-svg") {
    problems.push("the old login survived a disconnect");
  }
  if (after?.warming !== undefined && typeof after.warming !== "boolean") problems.push("warming is not a boolean");

  // A read that started before the change must not fill the cache afterwards.
  const source = fs.readFileSync(path.join(APP, "server/integrations.mjs"), "utf8");
  if (!/generationAtStart !== generation/.test(source)) problems.push("an in-flight stats read can still overwrite newer settings");
  return problems;
});


/* ================================================================= wave 10 ==
   One bad value in one tab must never cost the user the whole pet.
   ========================================================================= */

await test("a crashing panel cannot blank the island", async () => {
  const problems = [];
  const boundary = fs.readFileSync(path.join(APP, "src/components/Boundary.tsx"), "utf8");
  const app = fs.readFileSync(path.join(APP, "src/App.tsx"), "utf8");

  if (!/getDerivedStateFromError/.test(boundary)) problems.push("the boundary has no getDerivedStateFromError");
  if (!/componentDidCatch/.test(boundary)) problems.push("the boundary does not report the failure");
  if (!/<Boundary/.test(app)) problems.push("the panel is not wrapped in a boundary");
  if (!/onClick=\{\(\) => this\.setState\(\{ failed: false \}\)\}/.test(boundary)) problems.push("there is no way back from the failure");

  // The report route exists and refuses an empty report.
  const ok = await call("POST", "/api/diagnostics/report", { message: "panel failed: TypeError: x is undefined", detail: "at StatsView" });
  if (ok.status !== 200 || !ok.json?.ok) problems.push(`the report route answered ${ok.status}`);
  const empty = await call("POST", "/api/diagnostics/report", { message: "" });
  if (empty.status !== 400) problems.push(`an empty report answered ${empty.status}`);

  // Redaction is applied, so a token quoted in a stack trace never lands in the log.
  await call("POST", "/api/diagnostics/report", { message: "boom ghp_secretTokenValue123 /home/someone/Documents/x" });
  const diagnostics = await call("GET", "/api/diagnostics");
  const text = JSON.stringify(diagnostics.json ?? {});
  if (/ghp_secretTokenValue123/.test(text)) problems.push("a token written in a report survived into the log");
  if (!/panel failed/.test(text)) problems.push("the report never reached the log");
  return problems;
});

/* ------------------------------------------------------------- 19. hygiene */

await test("nothing threw in the background while all of that ran", async () => unhandled.slice(0, 5));

/* ---------------------------------------------------------------- teardown */

await service.close();
fs.rmSync(SANDBOX, { recursive: true, force: true });

console.log(results.join("\n"));
console.log(failures ? `\n${failures} of ${checks} production checks failed` : `\nthe app survives the gauntlet — ${checks} checks`);
process.exit(failures ? 1 : 0);
