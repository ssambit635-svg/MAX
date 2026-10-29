/**
 * Auto-update.
 *
 * Uses electron-updater against the GitHub Releases that `release.yml` publishes, so
 * a new version installs itself instead of asking people to download a zip.
 *
 * Rules:
 *   • only in a packaged build — `npm run desktop` never phones home
 *   • checks 30s after boot, then every 6 hours
 *   • downloads in the background, installs only when the user says so
 *   • every outcome is reported to the island as a plain sentence, never an error dump
 */

import { app, BrowserWindow } from "electron";

const CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** @type {import("electron-updater").AppUpdater | null} */
let updater = null;
let timers = [];
let last = { state: "idle", version: null, message: "Not checked yet." };

const send = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

const report = (state, message, version = last.version) => {
  last = { state, version, message };
  send("max:update", last);
  return last;
};

export const updateStatus = () => last;

/** Wire electron-updater. Safe to call in dev — it simply does nothing there. */
export async function initUpdater() {
  if (!app.isPackaged) {
    return report("disabled", "Updates are off in development builds.");
  }
  try {
    const { autoUpdater } = await import("electron-updater");
    updater = autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    updater.on("checking-for-update", () => report("checking", "Looking for a new version…"));
    updater.on("update-available", (info) => report("available", `Version ${info.version} is downloading.`, info.version));
    updater.on("update-not-available", () => report("current", "You're on the newest version."));
    updater.on("download-progress", (progress) =>
      report("downloading", `Downloading update — ${Math.round(progress.percent ?? 0)}%.`),
    );
    updater.on("update-downloaded", (info) =>
      report("ready", `Version ${info.version} is ready. Restart to install.`, info.version),
    );
    updater.on("error", () => report("error", "I couldn't check for updates just now."));

    const check = () => {
      updater?.checkForUpdates().catch(() => report("error", "I couldn't check for updates just now."));
    };
    timers.push(setTimeout(check, CHECK_DELAY_MS));
    timers.push(setInterval(check, CHECK_INTERVAL_MS));

    return report("idle", "Update checks are on.");
  } catch {
    return report("disabled", "Updates are unavailable in this build.");
  }
}

/** Ask now (tray item or Settings). */
export async function checkForUpdates() {
  if (!app.isPackaged || !updater) return report("disabled", "Updates only work in an installed build.");
  report("checking", "Looking for a new version…");
  try {
    await updater.checkForUpdates();
  } catch {
    return report("error", "I couldn't check for updates just now.");
  }
  return last;
}

/** Quit and install what has already downloaded. */
export function installUpdate() {
  if (!updater || last.state !== "ready") return false;
  setImmediate(() => updater.quitAndInstall(false, true));
  return true;
}

export function stopUpdater() {
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  timers = [];
}
