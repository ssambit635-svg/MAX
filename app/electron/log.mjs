/**
 * The main process keeps a diary.
 *
 * A packaged app has no console, so anything the shell complains about is lost —
 * and a lost error is what turns "it crashed once" into an unreproducible bug
 * report. Everything that goes wrong in the shell lands here, in the same folder
 * the service already writes to, with the same rotation rule.
 */

import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 256 * 1024;
let logFile = null;

/**
 * Called once, after `app.getPath("userData")` exists.
 * @param {string} dir
 */
export function initLog(dir) {
  logFile = path.join(dir, "state", "logs", "shell.log");
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  } catch {
    logFile = null;
  }
  return logFile;
}

function rotate() {
  if (!logFile) return;
  try {
    const { size } = fs.statSync(logFile);
    if (size < MAX_BYTES) return;
    const previous = `${logFile}.1`;
    fs.rmSync(previous, { force: true });
    fs.renameSync(logFile, previous);
  } catch {
    /* a missing file needs no rotation */
  }
}

const clean = (value) =>
  String(value ?? "")
    // A path or a token in a stack trace is exactly what must not be shared.
    .replace(/(ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{16,}/g, "$1…")
    .replace(/home[\\/][^\\/\s"']+/gi, "~")
    .replace(/Users[\\/][^\\/\s"']+/g, "~")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "…@…");

/**
 * @param {"info"|"warn"|"error"} level
 * @param {string} message
 * @param {unknown} [detail] an Error, or any value worth keeping
 */
export function log(level, message, detail) {
  const line = `[${new Date().toISOString()}] ${level} ${clean(message)}${
    detail === undefined ? "" : ` :: ${clean(detail instanceof Error ? (detail.stack ?? detail.message) : detail)}`
  }\n`;
  if (process.env.MAX_DEBUG) process.stderr.write(line);
  if (!logFile) return;
  try {
    rotate();
    fs.appendFileSync(logFile, line, "utf8");
  } catch {
    /* logging must never be the reason something fails */
  }
}

export const logError = (message, detail) => log("error", message, detail);

/**
 * Turns anything thrown into a sentence a person can act on, without leaking a
 * stack or a folder name into the island.
 */
export function describe(error) {
  if (error instanceof Error) return error.message || error.name || "Something went wrong.";
  if (typeof error === "string") return error;
  return "Something went wrong.";
}
