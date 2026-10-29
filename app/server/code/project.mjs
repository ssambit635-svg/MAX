/**
 * Project scan.
 *
 * Reviews a whole folder with the same rule book the editor uses, then reports the
 * files worth fixing first. Reads only, never writes, never leaves the machine.
 *
 * Guardrails: depth limit, file count limit, size limit, an ignore list for build
 * output and dependencies, and no traversal into hidden folders or system paths.
 */

import fs from "node:fs";
import path from "node:path";
import { review } from "./engine.mjs";
import { detectLanguage } from "./languages.mjs";
import { MAX_BYTES, isBlockedPath } from "./files.mjs";

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "vendor",
  "bin",
  "obj",
  "__pycache__",
  "venv",
  "env",
  "release",
  "ios",
  "android",
]);

const SEVERITY_WEIGHT = { error: 12, warn: 5, info: 1.5 };

const DEFAULT_LIMITS = { files: 400, bytes: MAX_BYTES, depth: 6 };

/** All supported source files under `root`, newest-first ordering left to the caller. */
function collectFiles(root, limits = {}) {
  const config = { ...DEFAULT_LIMITS, ...limits };
  const found = [];
  let inspected = 0;

  const walk = (dir, depth) => {
    if (found.length >= config.files || depth > config.depth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= config.files) return;
      const name = entry.name;
      if (name.startsWith(".") || IGNORED_DIRS.has(name.toLowerCase())) continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      inspected += 1;
      const language = detectLanguage(full);
      if (language.id === "text") continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size === 0 || stat.size > config.bytes) continue;
        found.push({ path: full, name, size: stat.size, modified: stat.mtime.toISOString(), language: language.id });
      } catch {
        /* skip unreadable entries */
      }
    }
  };

  walk(path.resolve(root), 0);
  return { files: found, inspected };
}

/**
 * Review every source file in a folder.
 *
 * @returns {{
 *   ok: boolean, message?: string, root?: string, score?: number,
 *   summary?: {files, errors, warnings, hints, lines}, languages?: {id,label,files}[],
 *   worst?: {path, name, language, score, errors, warnings, hints, issues}[],
 *   skipped?: number
 * }}
 */
export function scanProject(root, { limits = {}, maxReports = 8 } = {}) {
  const resolved = path.resolve(String(root ?? ""));
  if (!root) return { ok: false, message: "Give me a folder to scan." };
  if (isBlockedPath(resolved)) return { ok: false, message: "That folder belongs to the system, so I won't read it." };
  if (!fs.existsSync(resolved)) return { ok: false, message: "I couldn't find that folder." };
  if (!fs.statSync(resolved).isDirectory()) return { ok: false, message: "That's a file, not a folder." };

  const { files, inspected } = collectFiles(resolved, limits);
  if (!files.length) {
    return { ok: false, message: "No source files I understand in that folder." };
  }

  const languages = new Map();
  const reports = [];
  const summary = { files: files.length, errors: 0, warnings: 0, hints: 0, lines: 0 };
  let penalty = 0;

  for (const file of files) {
    let code;
    try {
      code = fs.readFileSync(file.path, "utf8");
    } catch {
      continue;
    }
    if (code.includes("\u0000")) continue;

    const result = review(code, file.language);
    summary.errors += result.stats.errors;
    summary.warnings += result.stats.warnings;
    summary.hints += result.stats.hints;
    summary.lines += result.stats.lines;
    penalty += result.issues.reduce((sum, issue) => sum + (SEVERITY_WEIGHT[issue.severity] ?? 0), 0);

    languages.set(file.language, (languages.get(file.language) ?? 0) + 1);

    if (result.issues.length) {
      reports.push({
        path: file.path,
        name: file.name,
        language: file.language,
        score: result.score,
        errors: result.stats.errors,
        warnings: result.stats.warnings,
        hints: result.stats.hints,
        issues: result.issues.slice(0, 5).map(({ severity, title, line, message }) => ({ severity, title, line, message })),
      });
    }
  }

  // Errors first, then the lowest score; the first few are the ones worth opening.
  reports.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || a.score - b.score || a.name.localeCompare(b.name));

  const perFile = Math.max(1, files.length);
  const average = penalty / perFile;
  const score = Math.max(0, Math.round(100 - Math.min(100, average * 1.6)));

  return {
    ok: true,
    root: resolved,
    score,
    summary,
    languages: [...languages.entries()]
      .map(([id, count]) => ({ id, label: detectLanguage(`x.${id}`).label || id, files: count }))
      .sort((a, b) => b.files - a.files),
    worst: reports.slice(0, maxReports),
    clean: reports.length === 0,
    skipped: Math.max(0, inspected - files.length),
  };
}

/** One-line summary for the composer / toast. */
export function scanMessage(result) {
  if (!result.ok) return result.message;
  if (result.clean) {
    return `Scanned ${result.summary.files} files — all clean. Score ${result.score}.`;
  }
  const worst = result.worst[0];
  const parts = [
    `${result.summary.errors} error${result.summary.errors === 1 ? "" : "s"}`,
    `${result.summary.warnings} warning${result.summary.warnings === 1 ? "" : "s"}`,
    `across ${new Set(result.worst.map((entry) => entry.path)).size} file(s)`,
  ];
  const first = worst ? ` Start with ${worst.name}: ${worst.issues[0]?.title ?? "issues found"}.` : "";
  return `Scanned ${result.summary.files} files, score ${result.score} — ${parts.join(", ")}.${first}`;
}
