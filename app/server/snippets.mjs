/**
 * Snippets.
 *
 * Small code fragments you reuse: a debounce, a fetch wrapper, a docker one-liner.
 * Stored as plain JSON next to the notes, never sent anywhere. `copy` returns the text
 * so the island can put it on the clipboard — the server never writes to it.
 */

import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./store.mjs";

const FILE = path.join(STATE_DIR, "snippets.json");
const MAX_SNIPPETS = 200;
const MAX_LENGTH = 20_000;

const clean = (value, limit) => String(value ?? "").slice(0, limit).trim();

function loadSnippets() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.name === "string" && typeof entry.code === "string")
      .slice(0, MAX_SNIPPETS);
  } catch {
    return [];
  }
}

function persist(snippets) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(snippets.slice(0, MAX_SNIPPETS), null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** @returns {{ok:true, snippet:{name,code,at}, replaced:boolean} | {ok:false, message:string}} */
export function saveSnippet(name, code) {
  // A name is a label, not a path: reject separators instead of silently mangling them.
  if (/[\\/]/.test(String(name ?? ""))) return { ok: false, message: "Snippet names can't contain slashes." };
  const cleanName = clean(name, 60).replace(/[^\w .+-]/g, "").trim();
  const cleanCode = clean(code, MAX_LENGTH);
  if (!cleanName) return { ok: false, message: "Give the snippet a name first." };
  if (!cleanCode) return { ok: false, message: "There is no code to save yet." };

  const snippets = loadSnippets();
  const existing = snippets.findIndex((entry) => entry.name.toLowerCase() === cleanName.toLowerCase());
  const snippet = { name: cleanName, code: cleanCode, at: new Date().toISOString() };
  if (existing >= 0) snippets[existing] = snippet;
  else snippets.unshift(snippet);

  if (!persist(snippets)) return { ok: false, message: "I couldn't save that snippet." };
  return { ok: true, snippet, replaced: existing >= 0 };
}

/** Fuzzy by name (exact, then prefix, then contains), then by what is inside the code. */
export function findSnippet(query) {
  const needle = clean(query, 80).toLowerCase();
  if (!needle) return null;
  const snippets = loadSnippets();
  return (
    snippets.find((entry) => entry.name.toLowerCase() === needle) ??
    snippets.find((entry) => entry.name.toLowerCase().startsWith(needle)) ??
    snippets.find((entry) => entry.name.toLowerCase().includes(needle)) ??
    snippets.find((entry) => entry.code.toLowerCase().includes(needle)) ??
    null
  );
}

export function deleteSnippet(name) {
  const target = findSnippet(name);
  if (!target) return { ok: false, message: `No snippet called “${clean(name, 40)}”.` };
  const remaining = loadSnippets().filter((entry) => entry.name !== target.name);
  if (!persist(remaining)) return { ok: false, message: "I couldn't delete that snippet." };
  return { ok: true, removed: target.name };
}

/** Names and sizes only — the list view never needs the code itself. */
export function snippetIndex() {
  return loadSnippets().map((entry) => ({
    name: entry.name,
    size: entry.code.length,
    lines: entry.code.split("\n").length,
    at: entry.at,
  }));
}
