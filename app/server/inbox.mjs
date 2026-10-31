/**
 * Capture, and finding what you captured.
 *
 * The point of capture is that it costs nothing: one line typed anywhere becomes
 * a bullet in today's file, and it is searchable the moment the key is released.
 * A note-per-file archive is great for reading and terrible for capture, so this
 * appends to one file per day (`inbox-2026-10-29.md`) and keeps an in-memory index
 * of the folder so search stays instant even with thousands of files.
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./store.mjs";
import { blockedReason } from "./paths.mjs";

const MAX_ENTRY = 4000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 4000;

const dayStamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const clockStamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Lowercase and strip diacritics, so "vadász" finds "vadasz". */
export const fold = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** A tag is a label, never a path: keep it short and harmless. */
export function cleanTag(tag) {
  const value = fold(tag)
    .replace(/[^a-z0-9 _+-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 24);
  return value || "";
}

/**
 * One line in, one bullet out. Returns a sentence a human can act on, because the
 * caller is either a toast or the pet's mouth.
 */
export function capture(text, { tag = "", now = new Date() } = {}) {
  const body = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ENTRY);
  if (!body) return { ok: false, message: "Nothing to capture — say what you want kept." };

  const config = loadConfig();
  const dir = config.saveDir;
  const blocked = blockedReason(dir);
  if (blocked) return { ok: false, message: `${blocked} Pick another notes folder in Settings.` };

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return { ok: false, message: `I can't open “${dir}”. Choose a folder you can write to.` };
  }

  const cleanLabel = cleanTag(tag);
  const file = path.join(dir, `inbox-${dayStamp(now)}.md`);

  // A checkbox stays a checkbox, but in the place the digest expects to find it.
  const task = body.match(/^[-*]?\s*\[\s?\]\s*(.+)$/u);
  const mark = task ? "[ ] " : "";
  const line = `- ${mark}${clockStamp(now)} ${cleanLabel ? `#${cleanLabel} ` : ""}${(task ? task[1] : body).trim()}\n`;

  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# Inbox · ${dayStamp(now)}\n\n`, "utf8");
    fs.appendFileSync(file, line, "utf8");
  } catch {
    return { ok: false, message: `I couldn't write to “${dir}”. Is the folder still there?` };
  }

  index.set(file, { at: 0, size: -1, text: "" }); // force a re-read next search
  return { ok: true, file, name: path.basename(file), line: line.trim(), tag: cleanLabel };
}

/* ------------------------------------------------------------------ search */

/** path -> { at, size, text }; a folder is small enough to hold in memory. */
const index = new Map();

function files(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(md|txt)$/i.test(entry.name))
      .slice(0, MAX_FILES)
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function textOf(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return "";
  }
  const known = index.get(file);
  if (known && known.at === stat.mtimeMs && known.size === stat.size) return known.text;
  if (stat.size > MAX_FILE_BYTES) {
    // A huge file is not a note: index the head so it still turns up in search.
    try {
      const handle = fs.openSync(file, "r");
      const buffer = Buffer.alloc(MAX_FILE_BYTES);
      const read = fs.readSync(handle, buffer, 0, MAX_FILE_BYTES, 0);
      fs.closeSync(handle);
      const text = buffer.subarray(0, read).toString("utf8");
      index.set(file, { at: stat.mtimeMs, size: stat.size, text });
      return text;
    } catch {
      return "";
    }
  }
  try {
    const text = fs.readFileSync(file, "utf8");
    index.set(file, { at: stat.mtimeMs, size: stat.size, text });
    return text;
  } catch {
    return "";
  }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A hit is worth more when the words are together, on one line, and near the top. */
function scoreLine(line, tokens, position) {
  const haystack = fold(line);
  let score = 0;
  for (const token of tokens) {
    const at = haystack.indexOf(token);
    if (at === -1) return -1; // every token must appear
    score += 10 - Math.min(at, 200) / 40;
  }
  if (haystack.includes(tokens.join(" "))) score += 8;
  return score + Math.max(0, 6 - position / 8);
}

/**
 * @returns {{ query: string, hits: {name,path,line,snippet,score,modified}[], took: number, scanned: number }}
 */
export function search(query, { limit = 12 } = {}) {
  const started = Date.now();
  const tokens = fold(query)
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length > 1)
    .slice(0, 8);
  const config = loadConfig();
  const dir = config.saveDir;
  if (!tokens.length) {
    return { query: String(query ?? ""), hits: [], took: Date.now() - started, scanned: 0, empty: true };
  }

  // Bullets, clocks, checkboxes and tags are noise when you are searching for words.
  const stripMarker = /^[-*]\s*(?:\[[ xX]\]\s*)?(?:\d{1,2}:\d{2}\s*)?(?:#[\w-]+\s*)?/u;
  const hits = [];
  const all = files(dir);
  for (const file of all) {
    const text = textOf(file);
    if (!text) continue;
    const lines = text.split("\n").slice(0, 4000);
    let best = null;
    for (let position = 0; position < lines.length; position += 1) {
      const raw = lines[position].replace(stripMarker, "").trim();
      if (raw.length < 2 || raw.startsWith("_Saved by MAX")) continue;
      const score = scoreLine(raw, tokens, position);
      if (score > (best?.score ?? -1)) best = { score, line: position, text: raw };
    }
    if (!best) continue;

    let modified = "";
    try {
      modified = fs.statSync(file).mtime.toISOString();
    } catch {
      /* a file removed mid-search */
    }
    const name = path.basename(file);
    hits.push({
      name,
      path: file,
      line: best.line + 1,
      snippet: best.text.slice(0, 240),
      score: Number(best.score.toFixed(2)) + (/inbox-/i.test(name) ? 1.5 : 0),
      modified,
    });
  }

  hits.sort((a, b) => b.score - a.score || String(b.modified).localeCompare(String(a.modified)));
  return { query: String(query ?? ""), hits: hits.slice(0, limit), took: Date.now() - started, scanned: all.length };
}

/** The `- [ ]` lines across the folder, newest file first. Used by the digest. */
export function openTasks({ limit = 12 } = {}) {
  const dir = loadConfig().saveDir;
  const tasks = [];
  const ordered = files(dir).sort((a, b) => b.localeCompare(a));
  for (const file of ordered) {
    const text = textOf(file);
    if (!text) continue;
    for (const line of text.split("\n")) {
      const match = line.match(/^[-*]\s*\[ \]\s+(.{1,200})$/u);
      if (!match) continue;
      // The timestamp and tag are bookkeeping; the task is the sentence.
      const words = match[1].replace(/^\d{1,2}:\d{2}\s*/u, "").replace(/^#[\w-]+\s*/u, "").trim();
      if (words) tasks.push({ text: words, name: path.basename(file), path: file });
      if (tasks.length >= limit) return tasks;
    }
  }
  return tasks;
}

/** Today's captured lines, in order. */
export function todayEntries(now = new Date()) {
  const dir = loadConfig().saveDir;
  const file = path.join(dir, `inbox-${dayStamp(now)}.md`);
  const text = textOf(file);
  if (!text) return [];
  return text
    .split("\n")
    .filter((line) => /^-\s/u.test(line))
    .map((line) => line.replace(/^-\s*/, "").trim())
    .slice(0, 200);
}

/** Highlight the match inside a snippet without letting the input inject markup. */
export function highlightSnippet(snippet, query) {
  const tokens = fold(query)
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length > 1);
  let html = String(snippet ?? "").replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
  for (const token of tokens) {
    html = html.replace(new RegExp(`(${escapeRegExp(token)})`, "giu"), "«$1»");
  }
  return html;
}

