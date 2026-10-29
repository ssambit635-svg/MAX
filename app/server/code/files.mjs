/**
 * Reading and writing code files.
 *
 * The editor may open a file anywhere on the machine, but writes are guarded: a
 * fixed extension allowlist, a size cap, and a hard block on system folders and
 * dotfiles. New files are only ever created inside the workspace folder.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectLanguage, LANGUAGES } from "./languages.mjs";

const MAX_BYTES = 512 * 1024;
const EXTENSIONS = new Set(LANGUAGES.flatMap((language) => language.extensions));

const BLOCKED_DIRS = [
  "windows",
  "system32",
  "syswow64",
  "program files",
  "program files (x86)",
  "programdata",
  "node_modules",
  ".git",
  ".ssh",
  ".gnupg",
  "library",
  "applications",
];

const BLOCKED_FILES = /(^|\/)(\.env|\.npmrc|\.netrc|id_rsa|id_ed25519|\.git-credentials|credentials|\.bash_history)$/i;

export const defaultWorkspace = () => path.join(os.homedir(), "Documents", "MAX code");

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function blockedReason(target) {
  const normalised = target.replace(/\\/g, "/").toLowerCase();
  const segments = normalised.split("/").filter(Boolean);
  if (segments.some((segment) => BLOCKED_DIRS.includes(segment))) return "That folder belongs to the system, so I won't touch it.";
  if (BLOCKED_FILES.test(normalised)) return "That looks like a secrets file, so I won't open it.";
  if (segments.some((segment) => segment.startsWith(".") && segment.length > 1 && segment !== "..")) {
    return "Hidden files are off limits.";
  }
  return null;
}

const size = (file) => fs.statSync(file).size;

/** @returns {{ ok: true, path, name, language, code, size, readOnly:false } | { ok:false, message }} */
export function readCodeFile(target, workspace) {
  const resolved = path.resolve(String(target ?? ""));
  if (!target) return { ok: false, message: "Pick a file first." };
  const reason = blockedReason(resolved);
  if (reason) return { ok: false, message: reason };
  if (!fs.existsSync(resolved)) return { ok: false, message: "I couldn't find that file." };
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) return { ok: false, message: "That's a folder, not a file." };
  if (stat.size > MAX_BYTES) return { ok: false, message: "That file is too big for the editor (over 512 KB)." };
  if (!EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    return { ok: false, message: "That file type isn't supported yet." };
  }

  let code;
  try {
    code = fs.readFileSync(resolved, "utf8");
  } catch {
    return { ok: false, message: "I couldn't read that file." };
  }
  if (code.includes("\u0000")) return { ok: false, message: "That isn't a text file." };

  return {
    ok: true,
    path: resolved,
    name: path.basename(resolved),
    language: detectLanguage(resolved).id,
    code,
    size: stat.size,
    inWorkspace: workspace ? isInside(path.resolve(workspace), resolved) : false,
    readOnly: false,
  };
}

/** @returns {{ ok: true, path, name, language, size, created } | { ok:false, message }} */
export function writeCodeFile(target, code, workspace) {
  const resolved = path.resolve(String(target ?? ""));
  if (!target) return { ok: false, message: "Name the file first." };
  const reason = blockedReason(resolved);
  if (reason) return { ok: false, message: reason };

  const extension = path.extname(resolved).toLowerCase();
  if (!EXTENSIONS.has(extension)) return { ok: false, message: "That file type isn't supported yet." };

  const source = String(code ?? "");
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) return { ok: false, message: "That file is too big to save." };

  const exists = fs.existsSync(resolved);
  const root = path.resolve(workspace ?? defaultWorkspace());
  if (!exists && !isInside(root, resolved)) {
    return { ok: false, message: "New files can only be created inside your workspace folder." };
  }
  if (exists && !fs.statSync(resolved).isFile()) return { ok: false, message: "That's a folder, not a file." };

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, source, "utf8");
  } catch {
    return { ok: false, message: "I couldn't save that file." };
  }

  return { ok: true, path: resolved, name: path.basename(resolved), language: detectLanguage(resolved).id, size: size(resolved), created: !exists };
}

/** Newest supported files in the workspace folder, one level deep. */
export function listWorkspace(workspace) {
  const root = path.resolve(workspace ?? defaultWorkspace());
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 2) walk(full, depth + 1);
      else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = fs.statSync(full);
          if (stat.size <= MAX_BYTES) {
            found.push({ name: entry.name, path: full, language: detectLanguage(full).id, size: stat.size, modified: stat.mtime.toISOString() });
          }
        } catch {
          /* skip */
        }
      }
    }
  };
  fs.mkdirSync(root, { recursive: true });
  walk(root, 0);
  return found.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 40);
}

