import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "./store.mjs";
import { APPS, addCustomApp, appCatalog, closeApp, findApp, launchApp, openUrl, removeCustomApp } from "./apps.mjs";
import { scanMessage, scanProject } from "./code/project.mjs";
import { readCodeFile } from "./code/files.mjs";
import { review } from "./code/engine.mjs";
import { detectLanguage } from "./code/languages.mjs";
import { deleteSnippet, findSnippet, saveSnippet, snippetIndex } from "./snippets.mjs";

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

export { appCatalog, findApp };

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

const HELP =
  "Try “open edge”, “open word”, “code”, “check ~/project/main.py”, “scan ~/project”, “save snippet debounce: …”, “snippet debounce”, “add app Figma: C:\\…\\Figma.exe”, “save note <text>”, “focus 25”, or “stats”.";

/** Strip quotes and a leading ~ so Windows and macOS paths are pasted as-is. */
function cleanPath(raw) {
  const text = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (text === "~") return process.env.USERPROFILE ?? process.env.HOME ?? text;
  if (text.startsWith("~/") || text.startsWith("~\\")) {
    return path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", text.slice(2));
  }
  return text;
}

function normaliseText(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Human answer for a launch that failed. Deliberately free of paths, commands and
 * error strings: this text is what a stranger sees on first run.
 */
function launchFailure(app, result = {}) {
  if (result.reason === "launch-failed") {
    return {
      ok: false,
      message: `${app.label} is installed, but it didn't start. Try opening it once by hand, then ask me again.`,
      mood: "error",
    };
  }
  if (result.reason === "missing") {
    return {
      ok: false,
      message: `I couldn't find ${app.label} on this machine. Install it, then press “scan again” in Actions.`,
      mood: "error",
    };
  }
  return { ok: false, message: `I couldn't open ${app.label}.`, mood: "error" };
}

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
  if (/^(code|lint|review|check code|code editor|editor)\b/.test(lower)) {
    const wantsFix = /\bfix|clean|repair\b/.test(lower);
    return {
      ok: true,
      message: wantsFix ? "Paste the code and I'll fix what's safe to fix." : "Code tab is open — paste a file and press Check.",
      ui: { tab: "code" },
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

  // ---- Code -------------------------------------------------------------
  const checkMatch = text.match(/^(?:check|lint|review)\s+(.+)$/i);
  if (checkMatch) {
    const target = cleanPath(checkMatch[1]);
    const file = readCodeFile(target);
    if (!file.ok) return { ok: false, message: file.message, mood: "error" };

    const result = review(file.code, file.language);
    const errors = result.stats.errors;
    const warnings = result.stats.warnings;
    const top = result.issues.slice(0, 3).map((issue) => `line ${issue.line}: ${issue.title}`);
    const summary = result.issues.length
      ? `${file.name} scores ${result.score} — ${errors} error(s), ${warnings} warning(s). ${top.join(" · ")}`
      : `${file.name} is clean. Score ${result.score}.`;
    return {
      ok: true,
      message: summary,
      ui: { tab: "code", openCode: { path: file.path, language: file.language, code: file.code } },
      mood: errors ? "error" : "happy",
    };
  }

  const scanMatch = text.match(/^(?:scan|audit)\s*(?:project|folder|repo|code)?\s*(.*)$/i);
  if (scanMatch && !/^scan\s+(?:my|the)?\s*$/.test(text)) {
    const rawTarget = cleanPath(scanMatch[1] ?? "");
    const target = rawTarget || loadConfig().codeDir || process.cwd();
    const result = scanProject(target);
    return {
      ok: result.ok,
      message: scanMessage(result),
      ui: result.ok ? { tab: "code", scan: result } : { tab: "code" },
      mood: result.ok ? (result.summary.errors ? "error" : "happy") : "error",
    };
  }

  // ---- Snippets ----------------------------------------------------------
  const snippetSave = text.match(/^(?:save|add|new)\s+snippet\s+(?:called\s+)?([\w .+-]{1,60}?)\s*[:=]\s*([\s\S]+)$/i);
  if (snippetSave) {
    const saved = saveSnippet(snippetSave[1], snippetSave[2]);
    return saved.ok
      ? {
          ok: true,
          message: `${saved.replaced ? "Updated" : "Saved"} snippet “${saved.snippet.name}”. Say “snippet ${saved.snippet.name}” to copy it.`,
          mood: "celebrate",
        }
      : { ok: false, message: saved.message, mood: "error" };
  }

  const snippetGet = text.match(/^(?:snippet|paste|copy snippet)\s+(.+)$/i);
  if (snippetGet) {
    const found = findSnippet(snippetGet[1]);
    if (!found) {
      const names = snippetIndex().map((entry) => entry.name);
      return {
        ok: false,
        message: names.length ? `No snippet called “${snippetGet[1]}”. You have: ${names.slice(0, 5).join(", ")}.` : "You have no snippets yet. Try “save snippet debounce: …”.",
        mood: "error",
      };
    }
    return {
      ok: true,
      message: `“${found.name}” copied — ${found.code.split("\n").length} line(s).`,
      ui: { copy: found.code },
      mood: "celebrate",
    };
  }

  if (/^(?:snippets|list snippets|my snippets)\b/i.test(lower)) {
    const names = snippetIndex();
    return {
      ok: true,
      message: names.length ? `You have ${names.length} snippet(s): ${names.map((entry) => entry.name).join(", ")}.` : "No snippets yet. Try “save snippet debounce: …”.",
      mood: "happy",
    };
  }

  const snippetDelete = text.match(/^(?:delete|remove)\s+snippet\s+(.+)$/i);
  if (snippetDelete) {
    const removed = deleteSnippet(snippetDelete[1]);
    return removed.ok
      ? { ok: true, message: `Deleted snippet “${removed.removed}”.`, mood: "happy" }
      : { ok: false, message: removed.message, mood: "error" };
  }

  // ---- Custom apps -------------------------------------------------------
  const addApp = text.match(/^add\s+(?:an?\s+)?app\s+([^:=]{1,40}?)\s*[:=]\s*(.+)$/i);
  if (addApp) {
    const result = addCustomApp(addApp[1], cleanPath(addApp[2]));
    if (!result.ok) return { ok: false, message: result.message, mood: "error" };
    saveConfig({ customApps: result.next });
    return { ok: true, message: `Added “${result.app.name}”. Say “open ${result.app.name}”.`, mood: "celebrate" };
  }

  const removeApp = text.match(/^(?:remove|delete|forget)\s+(?:the\s+)?app\s+(.+)$/i);
  if (removeApp) {
    const result = removeCustomApp(removeApp[1]);
    if (!result.ok) return { ok: false, message: result.message, mood: "error" };
    saveConfig({ customApps: result.next });
    return { ok: true, message: `Removed “${result.name}”.`, mood: "happy" };
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
    const app = findApp(targetText);

    // "open google" / "open github" — a known web destination beats an app guess.
    const web = Object.keys(WEB_TARGETS).find((key) => normaliseText(targetText).includes(key));
    if (app && app.id !== "browser") {
      const result = await launchApp(app);
      if (result.ok) {
        const label = result.label ?? app.label;
        return { ok: true, message: `Opened ${label}.`, ui: { launched: { id: app.id, label } }, mood: "happy" };
      }
      return launchFailure(app, result);
    }
    if (web) {
      const query = normaliseText(targetText).replace(new RegExp(`^\\s*${web}\\s*`, "i"), "").trim();
      const result = await openUrl(WEB_TARGETS[web](query));
      return result.ok
        ? { ok: true, message: `Opened ${web}.`, mood: "happy" }
        : { ok: false, message: "I couldn't open your browser.", mood: "error" };
    }
    if (app) {
      const result = await launchApp(app);
      return result.ok
        ? { ok: true, message: `Opened ${result.label ?? app.label}.`, mood: "happy" }
        : launchFailure(app, result);
    }
    if (/^(https?:\/\/|www\.)\S+$/i.test(targetText)) {
      const url = targetText.startsWith("http") ? targetText : `https://${targetText}`;
      const result = await openUrl(url);
      return result.ok ? { ok: true, message: `Opened ${url}.`, mood: "happy" } : { ok: false, message: "That link didn't open.", mood: "error" };
    }
    return {
      ok: false,
      message: `I don't have a shortcut for “${targetText}”. I know: ${APPS.filter((entry) => entry.id !== "browser")
        .slice(0, 8)
        .map((entry) => entry.label)
        .join(", ")}.`,
      mood: "error",
    };
  }

  const closeMatch = text.match(/^(?:close|quit|stop)\s+(.+)$/i);
  if (closeMatch) {
    const app = findApp(closeMatch[1]);
    if (!app) return { ok: false, message: `I don't have a safe close shortcut for “${closeMatch[1]}”.`, mood: "error" };
    if (app.protected) return { ok: false, message: `I won't close ${app.label} — it holds the desktop together.`, mood: "error" };
    const result = await closeApp(app);
    if (result.ok) return { ok: true, message: `Asked ${app.label} to close. Unsaved work stays yours to decide.`, mood: "happy" };
    if (result.reason === "protected") return { ok: false, message: `I won't close ${app.label}.`, mood: "error" };
    if (result.reason === "unsupported") return { ok: false, message: `I don't have a safe way to close ${app.label}.`, mood: "error" };
    if (result.reason === "not-running") return { ok: true, message: `${app.label} wasn't running, so nothing to close.`, mood: "happy" };
    return { ok: false, message: `I couldn't close ${app.label}.`, mood: "error" };
  }

  return {
    ok: false,
    message: `I didn't catch that one. ${HELP}`,
    mood: "error",
  };
}
