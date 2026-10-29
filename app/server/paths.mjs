/**
 * What MAX refuses to touch, in one place.
 *
 * Both the code editor and the note folder use these rules, and they used to be
 * duplicated — which is how a guard silently drifts. Nothing here imports another
 * server module, so anything may import it.
 */

import path from "node:path";

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
  "etc",
  "private",
  "usr",
  "bin",
  "sbin",
  "boot",
  "dev",
  "proc",
  "sys",
];

const BLOCKED_FILES = /(^|\/)(\.env|\.npmrc|\.netrc|id_rsa|id_ed25519|\.git-credentials|credentials|\.bash_history)$/i;

/** The reason a path is off limits, or null when it is fine. */
export function blockedReason(target) {
  const normalised = String(target ?? "").replace(/\\/g, "/").toLowerCase();
  if (!normalised) return null;
  const segments = normalised.split("/").filter(Boolean);
  if (segments.some((segment) => BLOCKED_DIRS.includes(segment))) {
    return "That folder belongs to the system, so I won't touch it.";
  }
  if (BLOCKED_FILES.test(normalised)) return "That looks like a secrets file, so I won't open it.";
  if (segments.some((segment) => segment.startsWith(".") && segment.length > 1 && segment !== "..")) {
    return "Hidden files are off limits.";
  }
  return null;
}

export const isBlockedPath = (target) => Boolean(blockedReason(path.resolve(String(target ?? ""))));

/** A folder MAX is allowed to write into: real, not empty, not a system folder. */
export function safeFolder(target) {
  const value = String(target ?? "").trim();
  if (!value) return null;
  if (isBlockedPath(value)) return null;
  return value;
}
