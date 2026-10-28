import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./store.mjs";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

/**
 * MAX only ever launches apps from this hand-written allowlist.
 * There is no shell execution of user text anywhere in the app.
 */
const APPS = [
  { id: "notepad", label: "Notepad", terms: ["notepad", "notes", "text editor"], win: "notepad.exe", mac: ["-a", "TextEdit"], linux: "gedit" },
  { id: "calculator", label: "Calculator", terms: ["calculator", "calc"], win: "calc.exe", mac: ["-a", "Calculator"], linux: "gnome-calculator" },
  { id: "chrome", label: "Google Chrome", terms: ["chrome", "google chrome", "browser"], win: "chrome.exe", mac: ["-a", "Google Chrome"], linux: "google-chrome" },
  { id: "edge", label: "Microsoft Edge", terms: ["edge", "microsoft edge"], win: "msedge.exe", mac: ["-a", "Microsoft Edge"], linux: "microsoft-edge" },
  { id: "firefox", label: "Firefox", terms: ["firefox"], win: "firefox.exe", mac: ["-a", "Firefox"], linux: "firefox" },
  { id: "vscode", label: "Visual Studio Code", terms: ["vs code", "vscode", "code", "visual studio code", "editor"], win: "code.cmd", mac: ["-a", "Visual Studio Code"], linux: "code" },
  { id: "explorer", label: "File Explorer", terms: ["file explorer", "explorer", "files", "finder", "folder"], win: "explorer.exe", mac: ["-a", "Finder"], linux: "xdg-open" },
  { id: "terminal", label: "Terminal", terms: ["terminal", "console", "shell", "command prompt", "powershell"], win: "wt.exe", mac: ["-a", "Terminal"], linux: "x-terminal-emulator" },
  { id: "paint", label: "Paint", terms: ["paint", "mspaint"], win: "mspaint.exe", mac: ["-a", "Preview"], linux: "krita" },
  { id: "spotify", label: "Spotify", terms: ["spotify", "music"], win: "spotify.exe", mac: ["-a", "Spotify"], linux: "spotify" },
  { id: "taskmgr", label: "Task Manager", terms: ["task manager", "taskmgr", "activity monitor"], win: "taskmgr.exe", mac: ["-a", "Activity Monitor"], linux: "gnome-system-monitor" },
  { id: "settings", label: "Settings", terms: ["settings", "preferences", "system settings"], win: "ms-settings:", mac: ["-a", "System Settings"], linux: "gnome-control-center" },
];

const WEB_TARGETS = {
  github: (q) => (q ? `https://github.com/search?q=${encodeURIComponent(q)}` : "https://github.com"),
  render: () => "https://dashboard.render.com",
  leetcode: (q) => (q ? `https://leetcode.com/problemset/?search=${encodeURIComponent(q)}` : "https://leetcode.com"),
  youtube: (q) => (q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : "https://www.youtube.com"),
  google: (q) => (q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : "https://www.google.com"),
  maps: (q) => `https://www.google.com/maps/search/${encodeURIComponent(q || "")}`,
  gmail: () => "https://mail.google.com",
  chatgpt: () => "https://chat.openai.com",
  vercel: () => "https://vercel.com/dashboard",
};

const OPEN_URL = { win: "cmd", mac: "open", linux: "xdg-open" };

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false, ...options });
      child.on("error", (error) => resolve({ ok: false, error }));
      child.on("spawn", () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({ ok: false, error });
    }
  });
}

function launchApp(app) {
  if (isWin) {
    if (app.win === "code.cmd") {
      return run("cmd", ["/c", "start", "", "code"]);
    }
    return run(app.win, []);
  }
  if (isMac) {
    return run("open", app.mac ?? []);
  }
  return run(app.linux ?? "xdg-open", []);
}

function openUrl(url) {
  if (isWin) return run("cmd", ["/c", "start", "", url]);
  if (isMac) return run("open", [url]);
  return run("xdg-open", [url]);
}

function findApp(text) {
  const needle = text.toLowerCase().replace(/^(the|my|a)\s+/, "").replace(/\s+(app|window|please)$/, "").trim();
  if (!needle) return null;
  const exact = APPS.find((app) => app.terms.includes(needle) || app.label.toLowerCase() === needle);
  if (exact) return exact;
  return APPS.find((app) => app.terms.some((term) => needle.includes(term) || term.includes(needle))) ?? null;
}

export function appCatalog() {
  return APPS.map(({ id, label, terms }) => ({ id, label, terms }));
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "note";
}

export function saveNote(text, name) {
  const config = loadConfig();
  const dir = config.saveDir || path.join(process.env.HOME ?? process.cwd(), "MAX", "notes");
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const base = `${stamp}-${slugify(name || text.split("\n")[0] || "note")}`;
  let file = path.join(dir, `${base}.md`);
  let counter = 2;
  while (fs.existsSync(file)) {
    file = path.join(dir, `${base}-${counter++}.md`);
  }
  const body = `# ${name || "Quick note"}\n\n_Saved by MAX · ${now.toLocaleString()}_\n\n${text.trim()}\n`;
  fs.writeFileSync(file, body, "utf8");
  return { file, dir, name: path.basename(file) };
}

export function recentNotes(limit = 6) {
  const config = loadConfig();
  const dir = config.saveDir;
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        return { name, path: full, modified: stat.mtime.toISOString(), size: stat.size };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function closeApp(app) {
  const names = {
    notepad: "notepad.exe",
    calculator: "calc.exe",
    chrome: "chrome.exe",
    edge: "msedge.exe",
    firefox: "firefox.exe",
    vscode: "Code.exe",
    spotify: "Spotify.exe",
    paint: "mspaint.exe",
  };
  const target = names[app.id];
  if (!target) return Promise.resolve({ ok: false });
  if (isWin) return run("taskkill", ["/IM", target]);
  if (isMac) return run("osascript", ["-e", `tell application "${app.label}" to quit`]);
  return run("pkill", ["-f", app.id]);
}

const HELP = "Try “open chrome”, “open vs code”, “save note <text>”, “search github for vite”, “timer 25”, or “stats”.";

/**
 * Deterministic command brain: no model, no network surprises, no shell.
 * Returns { ok, message, ui?, mood? } for the island to render.
 */
export async function handleCommand(rawInput) {
  const input = String(rawInput ?? "").replace(/\s+/g, " ").trim();
  if (!input) return { ok: false, message: "Say something like “open chrome”.", mood: "idle" };

  const text = input.replace(/^(?:hey\s+)?max[\s,.:;-]*/i, "").trim();
  const lower = text.toLowerCase();

  if (!lower) return { ok: true, message: "I'm right here.", mood: "happy" };

  // ---- UI intents -------------------------------------------------------
  if (/^(stats|statistics|how am i doing|my stats)\b/.test(lower)) {
    const which = lower.split(/\s+/).find((w) => ["github", "leetcode", "render", "vscode", "vs", "code", "system"].includes(w));
    return {
      ok: true,
      message: "Here are your numbers.",
      ui: { tab: "stats", highlight: which ? (which === "vs" ? "vscode" : which) : undefined },
      mood: "happy",
    };
  }
  if (/^(open\s+)?(settings|preferences)\b/.test(lower) && !/app/.test(lower)) {
    return { ok: true, message: "Settings are open.", ui: { tab: "settings" }, mood: "idle" };
  }
  if (/^(what can you do|help|commands|actions)\b/.test(lower)) {
    return { ok: true, message: HELP, ui: { tab: "actions" }, mood: "happy" };
  }
  if (/^(focus|pomodoro)\b/.test(lower)) {
    const minutes = Number((lower.match(/(\d{1,3})/) ?? [])[1] ?? 25);
    return { ok: true, message: `${Math.min(minutes, 180)} minute focus block started.`, ui: { focusMinutes: Math.min(Math.max(minutes, 1), 180) }, mood: "working" };
  }
  if (/^(timer|remind me in)\b/.test(lower)) {
    const minutes = Number((lower.match(/(\d{1,3})/) ?? [])[1] ?? 5);
    return { ok: true, message: `Timer set for ${Math.min(Math.max(minutes, 1), 180)} minutes.`, ui: { timerMinutes: Math.min(Math.max(minutes, 1), 180) }, mood: "thinking" };
  }

  // ---- Notes ------------------------------------------------------------
  const noteMatch = text.match(/^(?:save|note|write|remember|jot(?: down)?)\s*(?:note|this)?\s*(?:as|:)?\s*(.*)$/i);
  if (noteMatch && !/^save (?:this )?file$/i.test(text)) {
    const body = (noteMatch[1] ?? "").trim();
    if (!body) {
      return { ok: true, message: "Write it in the composer below — I'll save it as a Markdown file.", ui: { tab: "now", composer: "note" }, mood: "listening" };
    }
    const named = body.match(/^["']?([^":]{2,40})["']?\s*:\s*(.+)$/);
    const saved = saveNote(named ? named[2] : body, named ? named[1] : undefined);
    return { ok: true, message: `Saved as ${saved.name}.`, ui: { savedNote: saved }, mood: "celebrate" };
  }
  if (/^save (?:this )?file$/i.test(text) || /^new note$/i.test(text)) {
    return { ok: true, message: "Write the note and press ⌘/Ctrl + Enter to save it.", ui: { tab: "now", composer: "note" }, mood: "listening" };
  }

  // ---- Search -----------------------------------------------------------
  const searchMatch = text.match(/^(?:search|look up|google|find)\s+(?:(google|youtube|github|leetcode|web|maps)\s+)?(?:for\s+)?(.+)$/i);
  if (searchMatch) {
    const target = (searchMatch[1] ?? "google").toLowerCase() === "web" ? "google" : (searchMatch[1] ?? "google").toLowerCase();
    const query = (searchMatch[2] ?? "").trim();
    const builder = WEB_TARGETS[target] ?? WEB_TARGETS.google;
    const url = builder(query);
    const result = await openUrl(url);
    return result.ok
      ? { ok: true, message: `Searching ${target} for “${query}”.`, mood: "happy" }
      : { ok: false, message: "I couldn't reach your browser.", mood: "error" };
  }

  // ---- Small talk / info ------------------------------------------------
  if (/^(hi|hey|hello|yo|good (morning|evening|night))\b/.test(lower)) {
    return { ok: true, message: "Hey. I'm here — what are we doing?", mood: "happy" };
  }
  if (/^(thanks|thank you|ty)\b/.test(lower)) return { ok: true, message: "Anytime.", mood: "happy" };
  if (/^(what time|time is it|current time)/.test(lower)) {
    return { ok: true, message: `It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`, mood: "idle" };
  }
  if (/^(sleep|hide|go away|bye)\b/.test(lower)) return { ok: true, message: "I'll stay quiet for a bit.", ui: { sleep: true }, mood: "sleepy" };
  if (/^(wake|i'm back|im back)\b/.test(lower)) return { ok: true, message: "Awake.", mood: "happy" };

  // ---- App launching ----------------------------------------------------
  const openMatch = text.match(/^(?:open|launch|start|run|show me)\s+(.+)$/i);
  if (openMatch) {
    const targetText = openMatch[1].trim();
    const web = Object.keys(WEB_TARGETS).find((key) => targetText.toLowerCase().includes(key));
    const app = findApp(targetText);
    if (app) {
      const result = await launchApp(app);
      return result.ok
        ? { ok: true, message: `Opened ${app.label}.`, ui: { launched: app }, mood: "happy" }
        : { ok: false, message: `I couldn't find ${app.label} on this machine.`, mood: "error" };
    }
    if (web) {
      const result = await openUrl(WEB_TARGETS[web](targetText.replace(new RegExp(`^\\s*${web}\\s*`, "i"), "").trim()));
      return result.ok
        ? { ok: true, message: `Opened ${web}.`, mood: "happy" }
        : { ok: false, message: "I couldn't open your browser.", mood: "error" };
    }
    if (/^(https?:\/\/|www\.)\S+$/i.test(targetText)) {
      const url = targetText.startsWith("http") ? targetText : `https://${targetText}`;
      const result = await openUrl(url);
      return result.ok ? { ok: true, message: `Opened ${url}.`, mood: "happy" } : { ok: false, message: "That link didn't open.", mood: "error" };
    }
    return {
      ok: false,
      message: `I don't have a shortcut for “${targetText}”. I know: ${APPS.slice(0, 6).map((a) => a.label).join(", ")}.`,
      mood: "error",
    };
  }

  const closeMatch = text.match(/^(?:close|quit|stop)\s+(.+)$/i);
  if (closeMatch) {
    const app = findApp(closeMatch[1]);
    if (!app) return { ok: false, message: `I don't have a safe close shortcut for “${closeMatch[1]}”.`, mood: "error" };
    if (app.id === "explorer") return { ok: false, message: "I won't close the file manager — it holds the desktop.", mood: "error" };
    const result = await closeApp(app);
    return result.ok
      ? { ok: true, message: `Asked ${app.label} to close. Unsaved work stays yours to decide.`, mood: "happy" }
      : { ok: false, message: `I couldn't close ${app.label}.`, mood: "error" };
  }

  return {
    ok: false,
    message: `I didn't catch that one. ${HELP}`,
    mood: "error",
  };
}
