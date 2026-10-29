import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkForUpdates, initUpdater, installUpdate, stopUpdater, updateStatus } from "./updater.mjs";
import { clampToScreen, cleanWindowState, COLLAPSED, computeBounds, isOffScreen } from "./bounds.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// The local service is unpacked next to the asar archive (ESM cannot be imported from inside one).
const SERVER_ROOT = ROOT.includes("app.asar") ? ROOT.replace("app.asar", "app.asar.unpacked") : ROOT;
const PREFERRED_PORT = Number(process.env.MAX_API_PORT ?? 47199);
const PORT_SEARCH_RANGE = 12;
let BASE_URL = `http://127.0.0.1:${PREFERRED_PORT}`;

// Window sizes and placement live in ./bounds.mjs so they can be tested off-device.
// When folding, the panel fades, then the island folds, and only then does the
// frame shrink. A frame that snaps shut under a still-open panel is exactly what
// made it look stuck before.
const COLLAPSE_DELAY_MS = 470;

let win = null;
let tray = null;
let alwaysOnTop = true;
let quitting = false;
let currentMode = "collapsed";
let serverStarted = false;
let startupFailure = null;
let dragOrigin = null;

/** The only hosts the island links to, checked again in the shell. */
const TRUSTED_LINK_HOSTS = new Set(["github.com", "www.github.com", "leetcode.com", "www.leetcode.com", "render.com", "dashboard.render.com"]);

/** One gate for every way out of the island: the bridge, new windows, navigation. */
function openTrustedUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (!TRUSTED_LINK_HOSTS.has(parsed.hostname)) return false;
  void shell.openExternal(parsed.href);
  return true;
}

const stateFile = () => path.join(app.getPath("userData"), "window.json");

/**
 * window.json is written while the app runs, so a crash can leave half a file
 * behind. cleanWindowState turns whatever survived into numbers that can place
 * a window — a `null` here used to stop the island from opening at all.
 */
function readWindowState() {
  try {
    return cleanWindowState(JSON.parse(fs.readFileSync(stateFile(), "utf8")));
  } catch {
    return {};
  }
}

function writeWindowState(patch) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...readWindowState(), ...patch }, null, 2));
  } catch {
    /* not important */
  }
}

function workAreaFor(point) {
  try {
    return screen.getDisplayNearestPoint(point ?? screen.getCursorScreenPoint()).workArea;
  } catch {
    return screen.getPrimaryDisplay().workArea;
  }
}

// Growing is instant so the island has room to unfold into; shrinking waits for
// the fold so the panel is never squeezed by a window that got there first.
let pendingResize = null;

function boundsFor(mode, islandHeight) {
  const current = win.getBounds();
  const area = workAreaFor({ x: current.x + current.width / 2, y: current.y + 10 });
  const saved = readWindowState();
  // A monitor that is no longer attached must not drag the island off-screen.
  const anchor = isOffScreen(saved, area) ? {} : saved;
  return computeBounds({ mode, area, current, saved: anchor, islandHeight });
}

/** Frameless windows ignore some resizes while marked non-resizable; this borrows
 *  the flag for the one call that needs it instead of tweening through it. */
function setWindowBounds(bounds) {
  if (!win || win.isDestroyed()) return;
  const resizable = win.isResizable();
  if (!resizable) win.setResizable(true);
  win.setBounds(bounds, false);
  if (!resizable) win.setResizable(false);
}

function cancelPendingResize() {
  if (pendingResize) {
    clearTimeout(pendingResize);
    pendingResize = null;
  }
}

function sameBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function applyMode(mode, islandHeight = null) {
  if (!win || win.isDestroyed()) return;
  // A pending shrink must die the moment anything else asks for a size, or the
  // window folds itself a moment after the island was reopened.
  cancelPendingResize();

  const target = boundsFor(mode, islandHeight);
  const unchanged = mode === currentMode && sameBounds(win.getBounds(), target);
  currentMode = mode;
  if (unchanged) return;

  if (mode === "collapsed") {
    pendingResize = setTimeout(() => {
      pendingResize = null;
      setWindowBounds(boundsFor("collapsed"));
    }, COLLAPSE_DELAY_MS);
    return;
  }

  setWindowBounds(target);
}

async function waitForServer(timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) return true;
    } catch {
      /* keep waiting */
    }
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  return false;
}

async function startServer() {
  if (serverStarted) return;
  process.env.MAX_HOST = "127.0.0.1";
  process.env.MAX_API_PORT = String(PREFERRED_PORT);
  // Everything the service writes must live outside the read-only asar archive.
  process.env.MAX_STATE_DIR = path.join(app.getPath("userData"), "state");
  process.env.MAX_VERSION = app.getVersion();
  process.env.MAX_DIST_DIR = path.join(SERVER_ROOT, "dist");
  process.env.MAX_ASSETS_DIR = path.join(SERVER_ROOT, "assets");
  const service = await import(pathToFileURL(path.join(SERVER_ROOT, "server", "index.mjs")).href);

  // Another process may already own the preferred port (a stale MAX, a dev server, another app).
  let lastError = null;
  for (let offset = 0; offset < PORT_SEARCH_RANGE; offset++) {
    const port = PREFERRED_PORT + offset;
    try {
      await service.startServer({ port, host: "127.0.0.1" });
      BASE_URL = `http://127.0.0.1:${port}`;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") break;
    }
  }

  serverStarted = true;

  if (lastError) {
    console.error(`[max] could not start the local service: ${lastError.message}`);
    dialog.showErrorBox(
      "MAX could not start",
      `The local MAX service could not open a port on this machine.\n\n${lastError.message}`,
    );
    app.quit();
    return;
  }

  const ready = await waitForServer();
  if (!ready) {
    console.error("[max] local service did not answer in time");
    startupFailure = "The local MAX service did not answer. Windows may have blocked it, or another app is using its port.";
  }
}

function loadErrorPage(title, detail) {
  if (!win) return;
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    body { margin:0; height:100vh; display:grid; place-items:center; font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;
      background: radial-gradient(120% 90% at 50% 0%, #16304a 0%, #0a1622 55%, #050b13 100%); color:#e9f1fa; }
    .card { width:320px; padding:20px; border-radius:20px; background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.09); box-shadow:0 24px 60px -24px rgba(0,0,0,.8); text-align:center; }
    h1 { margin:10px 0 6px; font-size:15px; letter-spacing:.12em; }
    p { margin:0; font-size:12px; line-height:1.55; color:#a9b9cc; }
    .dot { width:9px; height:9px; border-radius:50%; background:#ff7d88; box-shadow:0 0 12px #ff7d88; display:inline-block; }
    .hint { margin-top:14px; font-size:11px; color:#6d8098; }
  </style>
  <div class="card">
    <span class="dot"></span>
    <h1>${title}</h1>
    <p>${detail}</p>
    <div class="hint">Close this window and start MAX again.</div>
  </div>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function createWindow() {
  const saved = readWindowState();
  const area = workAreaFor();
  const start = computeBounds({
    mode: "collapsed",
    area,
    current: { x: area.x + area.width / 2, y: area.y, width: COLLAPSED.width, height: COLLAPSED.height },
    saved: isOffScreen(saved, area) ? {} : saved,
  });
  const { x, y, width, height } = start;

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (startupFailure) {
    loadErrorPage("MAX could not start", startupFailure);
  } else {
    win.loadURL(`${BASE_URL}/?shell=desktop`);
  }

  win.once("ready-to-show", () => {
    win?.showInactive();
    if (!startupFailure) applyMode("collapsed");
  });

  win.on("closed", () => {
    win = null;
  });

  // A GPU driver reset or an out-of-memory renderer must not leave a blank,
  // always-on-top window: reload once, and give up quietly if it keeps happening.
  let recoveries = [];
  const recover = (reason) => {
    const now = Date.now();
    recoveries = recoveries.filter((at) => now - at < 60_000);
    recoveries.push(now);
    if (recoveries.length > 3) return; // a genuinely broken machine: stay put
    console.warn(`[max] reloading the island after ${reason}`);
    if (!startupFailure) win?.loadURL(`${BASE_URL}/?shell=desktop`);
  };
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details?.reason === "clean-exit") return;
    recover(`the renderer stopped (${details?.reason ?? "unknown"})`);
  });
  win.on("unresponsive", () => recover("it stopped answering"));

  win.on("move", () => {
    const bounds = win?.getBounds();
    if (bounds) writeWindowState({ x: Math.round(bounds.x + bounds.width / 2), y: bounds.y });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openTrustedUrl(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(BASE_URL)) {
      event.preventDefault();
      openTrustedUrl(url);
    }
  });
}

/** Ask the island to open. The renderer animates, then reports its size back. */
function openIsland() {
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  win.webContents.send("max:palette");
}

/** Ask the island to fold. Same path as clicking the chevron, so it cannot desync. */
function closeIsland() {
  win?.webContents.send("max:collapse");
}

function toggleWindow() {
  if (!win) return;
  if (currentMode === "expanded" && win.isVisible()) closeIsland();
  else openIsland();
}

function createTray() {
  const iconPath = path.join(SERVER_ROOT, "assets", "icon.png");
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("MAX — desktop companion");
  refreshTrayMenu();
  tray.on("click", () => openIsland());
}

/** Rebuild the menu so a checkbox never lies about the current state. */
function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open MAX", click: () => openIsland() },
      { label: "Command palette", accelerator: "CommandOrControl+Shift+Space", click: () => openIsland() },
      { type: "separator" },
      {
        label: "Always on top",
        type: "checkbox",
        checked: alwaysOnTop,
        click: (item) => {
          alwaysOnTop = item.checked;
          win?.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal");
          win?.webContents.send("max:pref-changed", { alwaysOnTop });
          refreshTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
          win?.webContents.send("max:pref-changed", { launchAtLogin: item.checked });
          refreshTrayMenu();
        },
      },
      { label: "Check for updates…", click: () => void checkForUpdates() },
      {
        label: updateStatus().state === "ready" ? `Restart to install ${updateStatus().version ?? "update"}` : "Restart to install update",
        visible: updateStatus().state === "ready",
        click: () => installUpdate(),
      },
      { label: "Open settings folder", click: () => shell.openPath(app.getPath("userData")) },
      { type: "separator" },
      { label: "Quit MAX", click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => openIsland());

  app.whenReady().then(async () => {
    app.setAppUserModelId("dev.max.companion");
    await startServer();
    createWindow();
    createTray();
    void initUpdater();

    if (startupFailure) return;

    // Capture from anywhere: the island opens with the composer already waiting,
    // which is the whole point of capture being cheap.
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      openIsland();
      win?.webContents.send("max:palette", { mode: "capture" });
      win?.webContents.send("max:capture");
    });
    // The plain toggle lives one key over, so both habits work.
    globalShortcut.register("CommandOrControl+Shift+M", () => toggleWindow());

    ipcMain.on("max:mode", (_event, payload) => {
      const mode = payload?.mode === "expanded" ? "expanded" : "collapsed";
      const height = Number(payload?.height);
      applyMode(mode, Number.isFinite(height) && height > 0 ? Math.ceil(height) : null);
    });


    // Manual dragging: `-webkit-app-region: drag` would swallow the clicks that open the island.
    ipcMain.on("max:drag-begin", (_event, point) => {
      // A pending fold would move the window mid-drag, so drop it first.
      cancelPendingResize();
      if (!win || typeof point?.screenX !== "number") return;
      const bounds = win.getBounds();
      dragOrigin = { screenX: point.screenX, screenY: point.screenY, x: bounds.x, y: bounds.y };
    });

    ipcMain.on("max:drag-move", (_event, point) => {
      if (!win || !dragOrigin || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
      const wanted = {
        ...win.getBounds(),
        x: Math.round(dragOrigin.x + (point.screenX - dragOrigin.screenX)),
        y: Math.round(dragOrigin.y + (point.screenY - dragOrigin.screenY)),
      };
      // A drag that leaves the screen must not lose the island for good.
      const area = workAreaFor({ x: wanted.x + wanted.width / 2, y: wanted.y + 10 });
      const safe = clampToScreen(wanted, area);
      win.setPosition(safe.x, safe.y, false);
    });

    // The Settings switches are the single source of truth for the OS login item and
    // always-on-top; the tray menu reflects the same state instead of guessing.
    ipcMain.on("max:login-item", (_event, enabled) => {
      app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true });
      refreshTrayMenu();
    });

    ipcMain.on("max:always-on-top", (_event, enabled) => {
      alwaysOnTop = Boolean(enabled);
      win?.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal");
      refreshTrayMenu();
    });

    ipcMain.on("max:open-external", (_event, url) => {
      // Only the places the island itself links to: a renderer that has been
      // talked into opening something else must not reach the browser.
      openTrustedUrl(url);
    });

    ipcMain.on("max:drag-end", () => {
      dragOrigin = null;
      const bounds = win?.getBounds();
      if (bounds) writeWindowState({ x: Math.round(bounds.x + bounds.width / 2), y: bounds.y });
    });
    ipcMain.on("max:quit", () => {
      quitting = true;
      app.quit();
    });

    ipcMain.handle("max:update-status", () => updateStatus());
    ipcMain.on("max:update-check", () => void checkForUpdates());
    ipcMain.on("max:update-install", () => installUpdate());

    app.on("activate", () => {
      if (!win) createWindow();
      win?.showInactive();
    });
  });

  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });

  process.on("uncaughtException", (error) => {
    console.error("[max] uncaught", error);
    if (app.isReady()) dialog.showErrorBox("MAX hit an unexpected error", String(error?.stack ?? error));
  });

  app.on("before-quit", () => {
    quitting = true;
    stopUpdater();
    globalShortcut.unregisterAll();
  });
}
