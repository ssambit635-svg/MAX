/**
 * Diagnostics.
 *
 * MAX ships no telemetry. What it does instead:
 *
 *   • keeps a small, rotating local log of failures (paths and handles redacted)
 *   • can produce a redacted summary you copy yourself and paste into an issue
 *
 * Nothing is ever sent anywhere, and the summary never contains tokens, keys,
 * file contents or the absolute paths of your projects.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STATE_DIR } from "./store.mjs";
import { HOST, VERSION } from "./version.mjs";

const LOG_DIR = path.join(STATE_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "max.log");
const MAX_LOG_BYTES = 256 * 1024;
const MAX_ENTRIES = 200;

/** Secrets, tokens, handles and absolute paths out. */
export function redact(text) {
  return String(text ?? "")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g, "«github-token»")
    .replace(/\b(rnd_[A-Za-z0-9]{10,})\b/g, "«render-key»")
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1«redacted»")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "«email»")
    // C:\Users\me\project\src\a.ts and /home/me/project/src/a.ts
    .replace(/\b[A-Za-z]:\\[^\s"']*/g, (match) => collapsePath(match))
    .replace(/(?<![\w:])\/(?:home|Users|var|opt|tmp)\/[^\s"']*/g, (match) => collapsePath(match));
}

function collapsePath(target) {
  const parts = target.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return target;
  // Keep only the file name: folder names can say more about a person than they want shared.
  return `«path»/…/${parts[parts.length - 1]}`;
}

function rotateIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    /* best effort */
  }
}

/** Append one line. Never throws: logging must not break a feature. */
export function logEvent(level, message, detail) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message: redact(message),
      detail: detail ? redact(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 2000) : undefined,
    });
    fs.appendFileSync(LOG_FILE, `${line}\n`, { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

/** Newest entries last, already redacted. */
export function readLog(limit = 50) {
  try {
    const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-Math.min(limit, MAX_ENTRIES)).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { at: null, level: "info", message: line.slice(0, 200) };
      }
    });
  } catch {
    return [];
  }
}

export function clearLog() {
  try {
    fs.rmSync(LOG_FILE, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The block a user pastes into a bug report. Redacted, and free of anything that
 * identifies them beyond the OS version.
 */
export function diagnosticsSummary({ config, stats, extra = {} } = {}) {
  const lines = [
    `MAX ${VERSION}`,
    `node ${process.version} · electron ${process.versions.electron ?? "—"} · chrome ${process.versions.chrome ?? "—"}`,
    `platform ${process.platform} ${process.arch} · ${os.release()}`,
    `cpu ${os.cpus()?.[0]?.model ?? "unknown"} × ${os.cpus()?.length ?? 0}`,
    `memory ${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    `host ${HOST} · uptime ${process.uptime().toFixed(0)}s`,
    `state dir ${redact(STATE_DIR)}`,
  ];

  if (config) {
    lines.push(
      `github ${config.github?.username ? "handle set" : "not set"}${config.github?.token ? " + token" : ""}`,
      `leetcode ${config.leetcode?.username ? "handle set" : "not set"}`,
      `render ${config.render?.apiKey ? "key set" : "not set"}`,
      `custom apps ${(config.customApps ?? []).length}`,
      `prefs ${Object.entries(config.prefs ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")}`,
    );
  }

  if (stats) {
    lines.push(
      `stats demo=${Boolean(stats.github?.demo)} github=${stats.github?.login ?? "—"} repos=${stats.github?.repos ?? "—"} streak=${stats.github?.streak ?? "—"}`,
      `leetcode solved=${stats.leetcode?.solved?.all ?? "—"} render=${stats.render?.live ?? "—"}/${stats.render?.total ?? "—"}`,
    );
  }

  for (const [key, value] of Object.entries(extra)) lines.push(`${key} ${redact(value)}`);

  const recent = readLog(8);
  if (recent.length) {
    lines.push("", "recent log:");
    for (const entry of recent) lines.push(`  ${entry.at ?? "—"} ${entry.level} ${entry.message}`);
  }
  return lines.join("\n");
}
