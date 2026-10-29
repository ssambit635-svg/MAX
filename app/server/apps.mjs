import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./store.mjs";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

/**
 * MAX only ever launches apps from this hand-written allowlist.
 * There is no shell execution of user text anywhere in the app.
 *
 * Windows is the target platform, and most desktop apps are *not* on PATH, so
 * every entry describes how to find its executable for real:
 *   paths    — absolute candidates, %VARS% expanded, `*` allowed for version folders
 *   registry — App Paths key, which is how Office and most installers register
 *   startNames — Start-menu names for Microsoft Store apps (WhatsApp, Copilot, Camera)
 *   protocol — URI handler launched through `start`
 */
export const APPS = [
  {
    id: "notepad",
    label: "Notepad",
    terms: ["notepad", "notes", "text editor"],
    closeName: "notepad.exe",
    win: { exe: "notepad.exe", paths: ["%SystemRoot%\\System32\\notepad.exe"] },
    mac: ["-a", "TextEdit"],
    linux: "gedit",
  },
  {
    id: "calculator",
    label: "Calculator",
    terms: ["calculator", "calc"],
    closeName: "CalculatorApp.exe",
    win: { exe: "calc.exe", paths: ["%SystemRoot%\\System32\\calc.exe"], protocol: "calculator:" },
    mac: ["-a", "Calculator"],
    linux: "gnome-calculator",
  },
  {
    id: "chrome",
    label: "Google Chrome",
    terms: ["chrome", "google chrome"],
    closeName: "chrome.exe",
    win: {
      exe: "chrome.exe",
      paths: [
        "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
        "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
        "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
      ],
      registry: "chrome.exe",
    },
    mac: ["-a", "Google Chrome"],
    linux: "google-chrome",
  },
  {
    id: "edge",
    label: "Microsoft Edge",
    terms: ["edge", "microsoft edge"],
    closeName: "msedge.exe",
    win: {
      exe: "msedge.exe",
      paths: [
        "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
        "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
        "%LOCALAPPDATA%\\Microsoft\\Edge\\Application\\msedge.exe",
      ],
      registry: "msedge.exe",
    },
    mac: ["-a", "Microsoft Edge"],
    linux: "microsoft-edge",
  },
  {
    id: "browser",
    label: "Browser",
    terms: ["browser", "default browser", "internet"],
    // No closeName and no direct target: this one opens whatever browser exists.
    fallback: ["chrome", "edge"],
    win: { defaultBrowser: true },
    mac: { defaultBrowser: true },
    linux: { defaultBrowser: true },
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    terms: ["vs code", "vscode", "code", "visual studio code", "editor"],
    closeName: "Code.exe",
    win: {
      exe: "Code.exe",
      paths: [
        "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe",
        "%ProgramFiles%\\Microsoft VS Code\\Code.exe",
        "%ProgramFiles(x86)%\\Microsoft VS Code\\Code.exe",
      ],
      registry: "Code.exe",
    },
    mac: ["-a", "Visual Studio Code"],
    linux: "code",
  },
  {
    id: "explorer",
    label: "File Explorer",
    terms: ["file explorer", "explorer", "files", "finder", "folder"],
    win: { exe: "explorer.exe", paths: ["%SystemRoot%\\explorer.exe"] },
    mac: ["-a", "Finder"],
    linux: "xdg-open",
    protected: true,
  },
  {
    id: "terminal",
    label: "Terminal",
    terms: ["terminal", "console", "shell", "command prompt", "powershell", "cmd"],
    closeName: "WindowsTerminal.exe",
    win: {
      // Windows Terminal is a Store app: its `wt.exe` in WindowsApps is a 0-byte
      // app-execution alias, so launching that path does nothing. Ask the Start
      // menu for the real package id first, and fall back to good old cmd.exe,
      // which is always a real file.
      exe: "wt.exe",
      preferStartMenu: true,
      startNames: ["Windows Terminal", "Terminal", "Windows Terminal (Preview)"],
      knownAppIds: ["Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe!App"],
      paths: ["%SystemRoot%\\System32\\cmd.exe"],
      registry: "cmd.exe",
      consoleFallback: true,
    },
    mac: ["-a", "Terminal"],
    linux: "x-terminal-emulator",
  },
  {
    id: "paint",
    label: "Paint",
    terms: ["paint", "mspaint"],
    closeName: "mspaint.exe",
    win: { exe: "mspaint.exe", paths: ["%SystemRoot%\\System32\\mspaint.exe"], registry: "mspaint.exe" },
    mac: ["-a", "Preview"],
    linux: "krita",
  },
  {
    id: "word",
    label: "Microsoft Word",
    terms: ["word", "ms word", "microsoft word", "docx", "document"],
    closeName: "WINWORD.EXE",
    win: {
      exe: "WINWORD.EXE",
      paths: [
        "%ProgramFiles%\\Microsoft Office\\root\\Office*\\WINWORD.EXE",
        "%ProgramFiles(x86)%\\Microsoft Office\\root\\Office*\\WINWORD.EXE",
        "%ProgramFiles%\\Microsoft Office\\Office*\\WINWORD.EXE",
        "%ProgramFiles(x86)%\\Microsoft Office\\Office*\\WINWORD.EXE",
        "%LOCALAPPDATA%\\Microsoft\\WindowsApps\\WINWORD.EXE",
      ],
      registry: "WINWORD.EXE",
      startNames: ["Word", "Microsoft Word"],
      protocol: "ms-word:",
    },
    mac: ["-a", "Microsoft Word"],
    linux: "libreoffice --writer",
  },
  {
    id: "wps",
    label: "WPS Office",
    terms: ["wps", "wps office", "wps writer", "kingsoft"],
    closeName: "wps.exe",
    win: {
      exe: "wps.exe",
      paths: [
        "%LOCALAPPDATA%\\Kingsoft\\WPS Office\\*\\office6\\wps.exe",
        "%ProgramFiles%\\Kingsoft\\WPS Office\\*\\office6\\wps.exe",
        "%ProgramFiles(x86)%\\Kingsoft\\WPS Office\\*\\office6\\wps.exe",
        "%ProgramFiles%\\WPS Office\\*\\office6\\wps.exe",
        "%LOCALAPPDATA%\\Kingsoft\\WPS Office\\ksolaunch.exe",
        "%ProgramFiles(x86)%\\Kingsoft\\WPS Office\\ksolaunch.exe",
      ],
      registry: "wps.exe",
      startNames: ["WPS Office", "WPS Office Pro"],
    },
    mac: ["-a", "wpsoffice"],
    linux: "wps",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    terms: ["whatsapp", "whats app", "wa"],
    closeName: "WhatsApp.exe",
    win: {
      exe: "WhatsApp.exe",
      paths: [
        "%LOCALAPPDATA%\\WhatsApp\\WhatsApp.exe",
        "%ProgramFiles%\\WindowsApps\\*WhatsApp*\\WhatsApp.exe",
        "%ProgramFiles%\\WhatsApp\\WhatsApp.exe",
      ],
      startNames: ["WhatsApp", "WhatsApp Beta"],
      knownAppIds: ["5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"],
      protocol: "whatsapp:",
    },
    mac: ["-a", "WhatsApp"],
    linux: "whatsapp-desktop",
  },
  {
    id: "copilot",
    label: "Copilot",
    terms: ["copilot", "co pilot", "ms copilot"],
    closeName: "Copilot.exe",
    win: {
      exe: "Copilot.exe",
      paths: ["%LOCALAPPDATA%\\Microsoft\\WindowsApps\\Copilot.exe"],
      startNames: ["Copilot", "Microsoft Copilot", "Windows Copilot"],
      knownAppIds: ["Microsoft.Copilot_8wekyb3d8bbwe!App", "Microsoft.Windows.Ai.Copilot.Provider_8wekyb3d8bbwe!App"],
    },
    mac: ["-a", "Copilot"],
    linux: "copilot",
  },
  {
    id: "camera",
    label: "Camera",
    terms: ["camera", "webcam"],
    closeName: "WindowsCamera.exe",
    win: {
      exe: "WindowsCamera.exe",
      paths: ["%ProgramFiles%\\WindowsApps\\*WindowsCamera*\\WindowsCamera.exe"],
      startNames: ["Camera"],
      knownAppIds: ["Microsoft.WindowsCamera_8wekyb3d8bbwe!App"],
      protocol: "microsoft.windows.camera:",
    },
    mac: ["-a", "Photo Booth"],
    linux: "cheese",
  },
  {
    id: "spotify",
    label: "Spotify",
    terms: ["spotify", "music"],
    closeName: "Spotify.exe",
    win: {
      exe: "Spotify.exe",
      paths: ["%APPDATA%\\Spotify\\Spotify.exe", "%ProgramFiles%\\Spotify\\Spotify.exe"],
      startNames: ["Spotify"],
    },
    mac: ["-a", "Spotify"],
    linux: "spotify",
  },
  {
    id: "taskmgr",
    label: "Task Manager",
    terms: ["task manager", "taskmgr", "activity monitor"],
    closeName: "Taskmgr.exe",
    win: { exe: "Taskmgr.exe", paths: ["%SystemRoot%\\System32\\Taskmgr.exe"] },
    mac: ["-a", "Activity Monitor"],
    linux: "gnome-system-monitor",
  },
  {
    id: "settings",
    label: "Settings",
    terms: ["settings", "preferences", "system settings"],
    win: { protocol: "ms-settings:" },
    mac: ["-a", "System Settings"],
    linux: "gnome-control-center",
  },
];

/* --------------------------------------------------------------- custom apps */

/** Program folders a user-defined launcher may point into. */
const BLOCKED_CUSTOM = /(^|[\\/])(windows|system32|syswow64|programdata)([\\/]|$)/i;

/** Turn the config's custom launchers into allowlist entries. */
export function customApps(configured = readConfiguredApps()) {
  return (configured ?? [])
    .filter((entry) => entry && typeof entry.name === "string" && typeof entry.path === "string")
    // Keep anything that still looks launchable here: a known program extension,
    // or a file that exists (macOS/Linux binaries usually have no extension).
    .filter((entry) => /\.(exe|bat|cmd|lnk|com|msc|app|sh|command)$/i.test(entry.path) || (fs.existsSync(entry.path) && (isWin || isExecutable(entry.path))))
    .filter((entry) => !BLOCKED_CUSTOM.test(entry.path))
    .slice(0, 40)
    .map((entry) => {
      const name = entry.name.trim().slice(0, 40);
      const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      return {
        id,
        label: name,
        terms: [normalise(name)],
        custom: true,
        target: entry.path,
        win: { direct: true, paths: [entry.path] },
        mac: [entry.path],
        linux: entry.path,
      };
    });
}

/** POSIX permissions say whether something can be run. */
function isExecutable(target) {
  try {
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Forget one of the user's own launchers. Built-ins cannot be removed. */
export function removeCustomApp(name, configured = readConfiguredApps()) {
  const needle = normalise(name);
  const remaining = configured.filter((entry) => normalise(entry.name) !== needle);
  if (remaining.length === configured.length) {
    const exists = APPS.some((app) => app.terms.includes(needle) || normalise(app.label) === needle);
    return {
      ok: false,
      message: exists ? `“${String(name).trim()}” is built in, so it always stays.` : `There's no custom app called “${String(name).trim()}”.`,
    };
  }
  return { ok: true, name: configured.find((entry) => normalise(entry.name) === needle)?.name, next: remaining };
}

/** Every app MAX knows: the built-in allowlist plus the user's own launchers. */
function allApps(configured = readConfiguredApps()) {
  return [...APPS, ...customApps(configured)];
}

/** The custom launchers from the saved config, or nothing if it cannot be read. */
function readConfiguredApps() {
  try {
    return loadConfig().customApps ?? [];
  } catch {
    return [];
  }
}

/** @returns {{ok:true, app}|{ok:false, message:string}} */
export function addCustomApp(name, target) {
  // A name is a label people type back at MAX, never part of a command line — but
  // keeping shell punctuation out of it means it can never look like one either.
  const cleanName = String(name ?? "")
    .replace(/[\\/`$;|&<>()[\]{}"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  const rawPath = String(target ?? "").trim().replace(/^"|"$/g, "");
  if (!cleanName) return { ok: false, message: "Give the app a name, like “Figma”." };
  if (!rawPath) return { ok: false, message: "Paste the app's full path after the name." };

  const resolved = path.resolve(rawPath);
  if (BLOCKED_CUSTOM.test(resolved)) return { ok: false, message: "That path is inside a system folder, so I won't add it." };
  if (!fs.existsSync(resolved)) return { ok: false, message: "That path doesn't exist on this machine." };
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) return { ok: false, message: "Point me at the app's .exe file, not a folder." };

  // On Windows a program is always an .exe/.bat/.lnk. On macOS and Linux most
  // programs have no extension at all (`/usr/bin/code`), so the test is "is it
  // executable", not "does it end in .exe".
  if (isWin) {
    if (stat.size > 0 && !/\.(exe|bat|cmd|lnk|com|msc)$/i.test(resolved)) {
      return { ok: false, message: "That file doesn't look like a program." };
    }
  } else if (stat.size > 0 && !/\.(sh|command|app)$/i.test(resolved) && !isExecutable(resolved)) {
    return { ok: false, message: "That file isn't executable, so it isn't a program." };
  }

  const existing = customApps();
  if (existing.some((app) => normalise(app.label) === normalise(cleanName))) {
    return { ok: false, message: `You already added “${cleanName}”.` };
  }
  if (APPS.some((app) => app.terms.includes(normalise(cleanName)))) {
    return { ok: false, message: `“${cleanName}” is already built in.` };
  }

  const next = [...(loadConfig().customApps ?? []), { name: cleanName, path: resolved }];
  return { ok: true, app: { name: cleanName, path: resolved }, next };
}

/* ------------------------------------------------------------------ matching */

function normalise(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findApp(text, configured) {
  const needle = normalise(text).replace(/^(the|my|a) /, "").replace(/ (app|window|please)$/, "");
  if (!needle) return null;

  const known = allApps(configured);
  const exact = known.find((app) => app.terms.includes(needle) || normalise(app.label) === needle);
  if (exact) return exact;

  // longest term wins, so "microsoft word" never lands on "word" inside another app
  let best = null;
  let bestLength = 0;
  for (const app of known) {
    for (const term of [...app.terms, normalise(app.label)]) {
      if (!term) continue;
      if (needle === term || needle.startsWith(`${term} `) || needle.endsWith(` ${term}`) || needle.includes(term)) {
        if (term.length > bestLength) {
          best = app;
          bestLength = term.length;
        }
      }
    }
  }
  // one-word typos of two letters or more still match on the term prefix ("chrom" → chrome)
  if (!best && needle.length >= 4) {
    best = known.find((app) => app.terms.some((term) => term.length >= 4 && term.startsWith(needle))) ?? null;
  }
  return best;
}

/* ------------------------------------------------------- filesystem resolution */

function expand(raw) {
  return raw.replace(/%([^%]+)%/g, (_match, key) => process.env[key] ?? process.env[key.toUpperCase()] ?? "");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve `*` segments against the real filesystem (version folders, WindowsApps). */
function glob(pattern) {
  if (!pattern.includes("*")) return fs.existsSync(pattern) ? [pattern] : [];
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (dir === pattern) return [];
  if (!base.includes("*")) {
    return glob(dir).flatMap((parent) => {
      const full = path.join(parent, base);
      return fs.existsSync(full) ? [full] : [];
    });
  }
  const matcher = new RegExp(`^${base.split("*").map(escapeRegExp).join(".*")}$`, "i");
  return glob(dir).flatMap((parent) => {
    try {
      return fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((entry) => matcher.test(entry.name))
        .map((entry) => path.join(parent, entry.name));
    } catch {
      return [];
    }
  });
}

/**
 * Programs under `...\WindowsApps\` are app-execution aliases: 0-byte stubs that
 * only the shell can turn into a real app. Spawning one directly fails silently,
 * which is exactly the "Terminal does nothing" bug.
 */
export function isAppExecutionAlias(candidate) {
  return /\\WindowsApps\\/i.test(candidate) && /\.[a-z0-9]{2,4}$/i.test(candidate);
}

function findOnPath(exe) {
  const hasExt = /\.[a-z0-9]{2,4}$/i.test(exe);
  const exts = hasExt ? [""] : ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, `${exe}${ext}`);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------- system lookups */

function runCapture(command, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? ""));
    });
  });
}

/** App Paths is where installers register GUI apps that are not on PATH. */
async function fromRegistry(exe) {
  if (!isWin) return null;
  const keys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
  ];
  for (const key of keys) {
    const out = await runCapture("reg", ["query", key, "/ve"]);
    if (!out) continue;
    const match = out.match(/REG_SZ\s+(.+?)\s*$/m);
    if (!match) continue;
    const candidate = match[1].replace(/^"|"$/g, "").trim();
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let startAppsCache = { at: 0, list: [] };

/** Microsoft Store apps have no exe path; they are launched by their Start-menu id. */
async function startApps() {
  if (Date.now() - startAppsCache.at < 10 * 60 * 1000) return startAppsCache.list;
  if (!isWin) return [];
  const out = await runCapture("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
  ]);
  let list = [];
  if (out) {
    try {
      const parsed = JSON.parse(out);
      list = (Array.isArray(parsed) ? parsed : [parsed])
        .filter((entry) => entry && entry.AppID)
        .map((entry) => ({ name: normalise(entry.Name), appId: String(entry.AppID) }));
    } catch {
      list = [];
    }
  }
  startAppsCache = { at: Date.now(), list };
  return list;
}

async function fromStartMenu(app) {
  const names = (app.win?.startNames ?? []).map(normalise);
  if (!names.length) return null;
  const list = await startApps();
  for (const wanted of names) {
    const hit = list.find((entry) => entry.name === wanted);
    if (hit) return hit.appId;
  }
  for (const wanted of names) {
    const hit = list.find((entry) => entry.name.includes(wanted) || wanted.includes(entry.name));
    if (hit) return hit.appId;
  }
  return null;
}

/* ------------------------------------------------------------------ resolving */

const CACHE_TTL = 5 * 60 * 1000;
const resolved = new Map();

function remember(id, result) {
  resolved.set(id, { at: Date.now(), result });
  return result;
}

/**
 * @returns {Promise<{ id, found: boolean, kind?: 'exe'|'appx'|'protocol'|'default-browser', target?: string, missing?: string[] }>}
 */
export async function resolveApp(app, { cache = true } = {}) {
  const cached = resolved.get(app.id);
  if (cache && cached && Date.now() - cached.at < CACHE_TTL) return cached.result;

  // "Browser" is not one program — it follows the fallback chain, then the OS default.
  const wantsDefault =
    app.win?.defaultBrowser === true || app.mac?.defaultBrowser === true || app.linux?.defaultBrowser === true;
  if (wantsDefault) return remember(app.id, { id: app.id, found: true, kind: "default-browser" });

  if (isMac) {
    const args = Array.isArray(app.mac) ? app.mac : [];
    if (!args.length) return remember(app.id, { id: app.id, found: false, missing: [`no macOS target for ${app.label}`] });
    if (args[0] === "-a") return remember(app.id, { id: app.id, found: true, kind: "exe", target: "/usr/bin/open" });
    return remember(app.id, { id: app.id, found: true, kind: "exe", target: args[0] });
  }

  if (!isWin) {
    const linux = typeof app.linux === "string" ? app.linux : "";
    const target = linux ? findOnPath(linux.split(" ")[0]) : null;
    if (!target) return remember(app.id, { id: app.id, found: false, missing: [linux || app.id] });
    const extra = linux.split(" ").slice(1);
    return remember(app.id, { id: app.id, found: true, kind: "exe", target, args: extra });
  }

  const win = app.win ?? {};

  const hits = (win.paths ?? [])
    .flatMap((candidate) => glob(path.normalize(expand(candidate))))
    .filter((hit) => !isAppExecutionAlias(hit));

  // Store-first apps ask the Start menu before anything else.
  const storeFirst = win.preferStartMenu ? await fromStore(app) : null;
  const onPath = !storeFirst && win.exe ? findOnPath(win.exe) : null;
  const registered = !storeFirst && !onPath && win.registry ? await fromRegistry(win.registry) : null;
  const storeLater = !storeFirst && !onPath && !registered ? await fromStore(app) : null;

  const choice = chooseWindowsTarget(app, {
    hits,
    onPath: onPath && !isAppExecutionAlias(onPath) ? onPath : null,
    registered: registered && !isAppExecutionAlias(registered) ? registered : null,
    appId: storeFirst ?? storeLater,
  });

  if (!choice) {
    return remember(app.id, {
      id: app.id,
      found: false,
      missing: [...hits, win.exe ? `${win.exe} (PATH)` : ""].filter(Boolean),
    });
  }
  return remember(app.id, choice);
}

/** Start-menu package id for Store apps, with stable ids as a fallback. */
async function fromStore(app) {
  const appId = await fromStartMenu(app);
  if (appId) return appId;
  const knownIds = app.win?.knownAppIds ?? [];
  if (knownIds.length && startAppsCache.list.length === 0) return knownIds[0];
  return null;
}

/**
 * The Windows decision tree, as a pure function so it can be tested off Windows.
 *
 * Order: Store package (for Store-first apps) → real file on disk → PATH →
 * registry App Paths → Store package → URI protocol.
 */
export function chooseWindowsTarget(app, { hits = [], onPath = null, registered = null, appId = null } = {}) {
  const win = app.win ?? {};
  const exe = (target) => ({
    id: app.id,
    found: true,
    kind: "exe",
    target,
    args: launchArgs(win, target),
  });
  const realFile = hits.find((hit) => /\.exe$/i.test(hit)) ?? hits[0] ?? null;

  if (win.preferStartMenu && appId) return { id: app.id, found: true, kind: "appx", target: appId };
  if (realFile) return exe(realFile);
  if (onPath) return exe(onPath);
  if (registered) return exe(registered);
  if (appId) return { id: app.id, found: true, kind: "appx", target: appId };
  if (win.protocol) return { id: app.id, found: true, kind: "protocol", target: win.protocol };
  return null;
}

/** A console app needs its own window; everything else is started bare. */
export function launchArgs(win, target) {
  if (win?.consoleFallback && /cmd\.exe$/i.test(String(target))) return ["/c", "start", "", "cmd.exe"];
  return [];
}

/** Resolve every allowlisted app once, in parallel, for the Actions list. */
export async function probeApps() {
  const entries = await Promise.all(
    allApps().map(async (app) => {
      const result = await resolveApp(app, { cache: false });
      return { id: app.id, label: app.label, terms: app.terms, available: result.found, how: result.kind ?? null };
    }),
  );
  return entries;
}

export function appCatalog(configured) {
  return allApps(configured).map(({ id, label, terms }) => {
    const cached = resolved.get(id);
    return {
      id,
      label,
      terms,
      available: cached ? cached.result.found : null,
      how: cached?.result.kind ?? null,
    };
  });
}

/* ------------------------------------------------------------------ launching */

function spawnDetached(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: "ignore", shell: false, windowsHide: false });
    } catch (error) {
      return resolve({ ok: false, error });
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", (error) => finish({ ok: false, error }));
    child.on("spawn", () => {
      child.unref();
      // A wrong target usually dies immediately with a non-zero code; give it a beat
      // so "Opened Chrome" is never printed for something that never appeared.
      setTimeout(() => {
        const code = child.exitCode;
        if (typeof code === "number" && code !== 0) finish({ ok: false, code });
        else finish({ ok: true });
      }, 350);
    });
  });
}

function openUrlDefault(url) {
  if (isWin) return spawnDetached("cmd", ["/c", "start", "", url]);
  if (isMac) return spawnDetached("open", [url]);
  return spawnDetached("xdg-open", [url]);
}

export function openUrl(url) {
  return openUrlDefault(url);
}

/**
 * Launch an allowlisted app, following its fallback chain (Browser → Chrome → Edge → default).
 * @returns {Promise<{ ok: boolean, label?: string, reason?: string, tried?: string[], kind?: string }>}
 */
export async function launchApp(app, seen = new Set()) {
  if (!app || seen.has(app.id)) return { ok: false, reason: "unknown" };
  seen.add(app.id);

  if (app.custom) {
    if (!fs.existsSync(app.target)) {
      return { ok: false, reason: "missing", tried: [app.target] };
    }
    const result = await spawnDetached(app.target, []);
    return result.ok ? { ok: true, kind: "exe" } : { ok: false, reason: "launch-failed" };
  }

  const resolution = await resolveApp(app);

  if (!resolution.found) {
    if (app.fallback?.length) {
      for (const id of app.fallback) {
        const next = APPS.find((entry) => entry.id === id);
        if (!next) continue;
        const attempt = await launchApp(next, seen);
        if (attempt.ok) return { ...attempt, label: next.label };
      }
    }
    return { ok: false, reason: "missing", tried: resolution.missing ?? [] };
  }

  if (resolution.kind === "default-browser") {
    // No browser detected: hand the home page to whatever Windows considers default.
    const result = isWin
      ? await spawnDetached("cmd", ["/c", "start", "", "https://www.google.com"])
      : await openUrlDefault("https://www.google.com");
    return result.ok ? { ok: true, label: "your browser", kind: "default-browser" } : { ok: false, reason: "launch-failed" };
  }

  if (resolution.kind === "appx") {
    const result = await spawnDetached("explorer.exe", [`shell:AppsFolder\\${resolution.target}`]);
    if (result.ok) return { ok: true, kind: "appx" };
    // A wrong package id is quiet: fall back to a plain console if this app has one.
    const exe = (app.win?.paths ?? []).map((candidate) => glob(path.normalize(expand(candidate)))).flat()[0];
    if (exe && !isAppExecutionAlias(exe)) {
      const retry = await spawnDetached(exe, app.win?.consoleFallback ? ["/c", "start", "", "cmd.exe"] : []);
      if (retry.ok) return { ok: true, kind: "exe" };
    }
    return { ok: false, reason: "launch-failed" };
  }

  if (resolution.kind === "protocol") {
    const result = await spawnDetached("cmd", ["/c", "start", "", resolution.target]);
    return result.ok ? { ok: true, kind: "protocol" } : { ok: false, reason: "launch-failed" };
  }

  const result = await spawnDetached(resolution.target, resolution.args ?? []);
  return result.ok ? { ok: true, kind: "exe" } : { ok: false, reason: "launch-failed" };
}

/** Ask the app to close politely. Returns { ok, reason }. */
export async function closeApp(app) {
  if (!app || app.protected) return { ok: false, reason: "protected" };
  if (!app.closeName) return { ok: false, reason: "unsupported" };
  if (isMac) {
    const result = await spawnDetached("osascript", ["-e", `tell application "${app.label}" to quit`]);
    return result.ok ? { ok: true } : { ok: false, reason: "launch-failed" };
  }
  if (isWin) {
    const result = await spawnDetached("taskkill", ["/IM", app.closeName]);
    return result.ok ? { ok: true } : { ok: false, reason: "not-running" };
  }
  const result = await spawnDetached("pkill", ["-f", app.id]);
  return result.ok ? { ok: true } : { ok: false, reason: "not-running" };
}
