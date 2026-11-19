import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LANGUAGES = new Set(["en-US", "hi-IN"]);
const EVENT_ERROR_CODES = new Set(["language-unavailable", "speech-engine-failed"]);

/** Owns the one-shot, local Windows System.Speech helper process. */
export function createWindowsDictation({
  platform = process.platform,
  systemRoot = process.env.SystemRoot,
  scriptPath,
  spawnChild = spawn,
  onEvent = () => {},
  timeoutMs = 90_000,
} = {}) {
  let child = null;
  let timeout = null;

  function clearTimer() {
    if (timeout) { clearTimeout(timeout); timeout = null; }
  }

  function notify(event) {
    try { onEvent(event); } catch { /* renderer failures must not crash the speech controller */ }
  }

  function stop() {
    const target = child;
    if (!target) return Promise.resolve();
    clearTimer();
    if (target.exitCode !== null || target.signalCode !== null) {
      if (child === target) child = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finished = false;
      let killTimer;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimer();
        if (killTimer) clearTimeout(killTimer);
        if (child === target) child = null;
        resolve();
      };
      target.once("close", finish);
      try { target.stdin.write("stop\n"); } catch { /* process may have exited */ }
      killTimer = setTimeout(() => {
        try { target.kill(); } catch { /* already closed */ }
        finish();
      }, 1500);
      killTimer.unref?.();
    });
  }

  function dispose() {
    clearTimer();
    if (child) {
      try { child.kill(); } catch { /* already closed */ }
      child = null;
    }
  }

  function start(language) {
    if (platform !== "win32") return { ok: false, message: "Offline voice dictation is currently supported only by the Windows desktop app." };
    if (!LANGUAGES.has(language)) return { ok: false, message: "Choose a supported dictation language." };
    if (child && child.exitCode === null && child.signalCode === null) return { ok: false, message: "Voice dictation is already listening." };
    if (typeof scriptPath !== "string" || !path.isAbsolute(scriptPath) || !fs.existsSync(scriptPath)) {
      return { ok: false, message: "The local speech helper is missing from this installation." };
    }

    const winPath = path.win32;
    if (typeof systemRoot !== "string" || !winPath.isAbsolute(systemRoot)) {
      return { ok: false, message: "MAX couldn't locate Windows PowerShell safely." };
    }
    const powershell = winPath.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    let processChild;
    try {
      // Process-scoped only: the app's fixed packaged helper must run even under a restrictive user policy; no machine policy is changed and no user script/text is executed.
      processChild = spawnChild(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-CultureName", language], {
        shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return { ok: false, message: "MAX couldn't start Windows local speech recognition." };
    }

    child = processChild;
    let buffer = "";
    let hadEvent = false;
    let failed = false;
    processChild.stdout.setEncoding("utf8");
    processChild.stderr.resume();
    processChild.stdout.on("data", (chunk) => {
      buffer = (buffer + chunk).slice(-8192);
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "text" && typeof event.text === "string" && event.text.length > 0 && event.text.length <= 1000) {
            hadEvent = true;
            notify({ type: "text", text: event.text });
          } else if (event.type === "status" && (event.state === "listening" || event.state === "stopped")) {
            hadEvent = true;
            notify({ type: "status", state: event.state });
          } else if (event.type === "error" && EVENT_ERROR_CODES.has(event.code)) {
            hadEvent = true;
            failed = true;
            notify({ type: "error", code: event.code });
          }
        } catch { /* Ignore malformed output from the helper. */ }
      }
    });
    processChild.once("error", () => {
      failed = true;
      hadEvent = true;
      clearTimer();
      if (child === processChild) child = null;
      notify({ type: "error", code: "speech-engine-failed" });
    });
    processChild.once("close", () => {
      clearTimer();
      if (child === processChild) child = null;
      if (!failed && !hadEvent) notify({ type: "error", code: "speech-engine-failed" });
      else if (!failed) notify({ type: "status", state: "stopped" });
    });
    timeout = setTimeout(() => { void stop(); }, timeoutMs);
    timeout.unref?.();
    return { ok: true };
  }

  return { start, stop, dispose };
}
