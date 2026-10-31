/**
 * "Switch to slack" — the fastest path to a window you already have open.
 *
 * Ranking is pure and exported, so it can be tested without launching anything.
 * Focus is attempted first (a running app should be brought forward, not started
 * a second time) and falls back to launching through the normal allowlist path,
 * which means no new way to run arbitrary programs is introduced here.
 */

import { spawnSync } from "node:child_process";
import { appCatalog, launchApp, customApps } from "./apps.mjs";

const CACHE_MS = 4000;
let cache = { at: 0, list: [] };

/** Fold case and punctuation so "VS Code" matches "vscode" and "vs-code". */
export const tidy = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f]+/g, "");

/** Every character of the query appears, in order: "vscd" still finds VS Code. */
function subsequence(needle, haystack) {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * @param {string} query
 * @param {{name: string, id?: string, running?: boolean, also?: string[]}[]} candidates
 * @returns {{name: string, score: number, running: boolean, candidate: object}[]}
 */
export function rank(query, candidates = []) {
  const needle = tidy(query);
  if (!needle) return [];
  const scored = [];
  for (const candidate of candidates) {
    const names = [candidate.name, ...(candidate.also ?? [])].filter(Boolean);
    let best = -1;
    for (const name of names) {
      const haystack = tidy(name);
      if (!haystack) continue;
      let score = -1;
      if (haystack === needle) score = 100;
      else if (haystack.startsWith(needle)) score = 80 - Math.min(20, haystack.length - needle.length);
      else if (haystack.includes(needle)) score = 60 - Math.min(20, haystack.indexOf(needle));
      else if (needle.length >= 3 && subsequence(needle, haystack)) score = 30;
      if (score > best) best = score;
    }
    if (best < 0) continue;
    // A window that is already open is one keystroke away instead of a cold start.
    if (candidate.running) best += 12;
    scored.push({ name: candidate.name, score: best, running: Boolean(candidate.running), candidate });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Runs a system tool and reports success, without ever throwing. */
function execute(command, args, { timeout = 2500, env } = {}) {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", timeout, windowsHide: true, env: { ...process.env, ...env } });
    return { ok: result.status === 0, out: String(result.stdout ?? "").trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

/** The stdout, or an empty string — for when only the text matters. */
function run(command, args, options) {
  return execute(command, args, options).out;
}

/** Friendly names for the windows a person could switch to. Best effort per OS. */
function runningApps() {
  if (Date.now() - cache.at < CACHE_MS) return cache.list;
  let list = [];

  if (process.platform === "win32") {
    const output = run("tasklist", ["/fo", "csv", "/nh"], { timeout: 3000 });
    const seen = new Set();
    for (const row of output.split(/\r?\n/)) {
      const cells = row.split('","').map((cell) => cell.replace(/^"|"$/g, "").trim());
      if (cells.length < 2) continue;
      const [image, pid] = cells;
      if (!image || !pid) continue;
      const key = tidy(image.replace(/\.exe$/i, ""));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ name: image.replace(/\.exe$/i, ""), pid: Number(pid), image });
    }
  } else if (process.platform === "darwin") {
    const output = run("osascript", ["-e", 'tell application "System Events" to get name of every process whose background only is false']);
    for (const name of output.split(/,\s*/)) {
      const clean = name.trim();
      if (clean) list.push({ name: clean });
    }
  } else if (process.platform === "linux") {
    const output = run("wmctrl", ["-lx"]) || "";
    const seen = new Set();
    for (const row of output.split("\n")) {
      const parts = row.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const name = parts.slice(2).join(" ").replace(/\.[^.]+\.[^.]+$/, "");
      const key = tidy(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ name });
    }
    if (!list.length) {
      for (const name of run("ps", ["-eo", "comm="]).split("\n")) {
        const clean = name.trim().split("/").pop();
        const key = tidy(clean);
        if (!clean || !key || seen.has(key)) continue;
        seen.add(key);
        list.push({ name: clean });
      }
    }
  }

  cache = { at: Date.now(), list };
  return list;
}

/** Everything the user could plausibly name: allowlist, their own launchers, live windows. */
export function candidates() {
  const live = runningApps();
  const liveByKey = new Map(live.map((entry) => [tidy(entry.name), entry]));
  const list = [];

  for (const app of appCatalog()) {
    const key = tidy(app.id);
    const hit = liveByKey.get(key) ?? live.find((entry) => tidy(entry.name) === tidy(app.label ?? ""));
    list.push({
      name: app.label ?? app.id,
      id: app.id,
      kind: "catalog",
      running: Boolean(hit),
      also: [app.id, ...(app.keywords ?? [])],
      app,
    });
  }

  for (const custom of customApps()) {
    list.push({ name: custom.name, id: custom.name, kind: "custom", running: false, app: custom });
  }

  for (const entry of live) {
    if (list.some((item) => tidy(item.name) === tidy(entry.name))) continue;
    list.push({ name: entry.name, id: entry.name, kind: "window", running: true });
  }

  return list;
}

/** Bring a running window forward. Returns false when the OS refused or lacked a tool. */
function focus(name) {
  const safe = String(name ?? "").replace(/["'`$\\]/g, "").trim().slice(0, 80);
  if (!safe) return false;

  if (process.platform === "win32") {
    // The name travels in an environment variable, never inside the script text.
    const script = [
      "$ErrorActionPreference='Stop'",
      "$target=$env:MAX_SWITCH_TARGET",
      "$shell=New-Object -ComObject WScript.Shell",
      "if ($shell.AppActivate($target)) { exit 0 }",
      "$p=Get-Process -Name $target -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "if ($p) { $shell.AppActivate($p.Id) | Out-Null; exit 0 }",
      "exit 1",
    ].join("; ");
    return execute("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 4000,
      env: { MAX_SWITCH_TARGET: safe },
    }).ok;
  }

  if (process.platform === "darwin") {
    return execute("open", ["-a", safe], { timeout: 4000 }).ok;
  }

  if (execute("wmctrl", ["-a", safe], { timeout: 2500 }).ok) return true;
  return execute("gtk-launch", [safe], { timeout: 2500 }).ok;
}

/** How a switch actually finished, in words the island can show. */
export async function switchTo(query) {
  const needle = String(query ?? "").trim();
  if (!needle) return { ok: false, message: "Switch to what? Try “switch spotify”." };

  const ranked = rank(needle, candidates());
  if (!ranked.length) {
    return { ok: false, message: `I don't see “${needle}” open or installed.` };
  }

  const top = ranked[0];
  const candidate = top.candidate;

  if (candidate.running && focus(candidate.name)) {
    return { ok: true, message: `Switched to ${candidate.name}.`, switched: candidate.name, launched: false, alternatives: ranked.slice(1, 4).map((r) => r.name) };
  }

  if (candidate.app) {
    const launched = await launchApp(candidate.app);
    if (launched.ok) {
      return { ok: true, message: `Opened ${candidate.name}.`, switched: candidate.name, launched: true, alternatives: ranked.slice(1, 4).map((r) => r.name) };
    }
    return {
      ok: false,
      message: `I found ${candidate.name} but couldn't start it.`,
      alternatives: ranked.slice(1, 4).map((r) => r.name),
    };
  }

  return { ok: false, message: `“${candidate.name}” is open but I couldn't bring it forward.`, alternatives: ranked.slice(1, 4).map((r) => r.name) };
}
