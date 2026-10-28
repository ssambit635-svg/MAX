import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.MAX_API_PORT ?? 47199);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const COLLAPSED = { width: 424, height: 104 };
const EXPANDED = { width: 858, height: 636 };

let win = null;
let petWin = null;
let tray = null;
let quitting = false;
let currentMode = "collapsed";
let serverStarted = false;

const stateFile = () => path.join(app.getPath("userData"), "window.json");

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
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

function applyMode(mode) {
  if (!win) return;
  currentMode = mode;
  const size = mode === "expanded" ? EXPANDED : COLLAPSED;
  const bounds = win.getBounds();
  const area = workAreaFor({ x: bounds.x + bounds.width / 2, y: bounds.y + 10 });
  const width = Math.min(size.width, area.width - 20);
  const height = Math.min(size.height, area.height - 20);
  const saved = readWindowState();
  const centerX = saved.x ?? bounds.x + bounds.width / 2;
  const x = Math.round(Math.min(Math.max(area.x + 8, centerX - width / 2), area.x + area.width - width - 8));
  const top = Math.round(Math.max(area.y + 6, Math.min(saved.y ?? area.y + 8, area.y + area.height - height - 6)));
  win.setBounds({ x, y: top, width, height }, true);
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
  process.env.MAX_API_PORT = String(PORT);
  await import(pathToFileURL(path.join(ROOT, "server", "index.mjs")).href);
  serverStarted = true;
  const ready = await waitForServer();
  if (!ready) console.error("[max] local service did not answer in time");
}

function createWindow() {
  const saved = readWindowState();
  const area = workAreaFor();
  const width = COLLAPSED.width;
  const height = COLLAPSED.height;
  const x = Math.round(Math.min(Math.max(area.x + 8, (saved.x ?? area.x + area.width / 2) - width / 2), area.x + area.width - width - 8));
  const y = Math.round(Math.max(area.y + 6, saved.y ?? area.y + 8));

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
  win.loadURL(`${BASE_URL}/?shell=desktop`);

  win.once("ready-to-show", () => {
    win?.showInactive();
    applyMode("collapsed");
  });

  win.on("closed", () => {
    win = null;
  });

  win.on("move", () => {
    const bounds = win?.getBounds();
    if (bounds) writeWindowState({ x: Math.round(bounds.x + bounds.width / 2), y: bounds.y });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(BASE_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function createPetWindow() {
  if (petWin) {
    petWin.show();
    return;
  }
  const saved = readWindowState();
  const area = workAreaFor();
  petWin = new BrowserWindow({
    width: 200,
    height: 216,
    x: Math.round(Math.min(Math.max(area.x + 24, saved.petX ?? area.x + area.width - 260), area.x + area.width - 220)),
    y: Math.round(Math.min(Math.max(area.y + 60, saved.petY ?? area.y + area.height - 300), area.y + area.height - 240)),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    focusable: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  petWin.setAlwaysOnTop(true, "floating");
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.loadURL(`${BASE_URL}/pet.html`);
  petWin.once("ready-to-show", () => petWin?.showInactive());
  petWin.on("move", () => {
    const bounds = petWin?.getBounds();
    if (bounds) writeWindowState({ petX: bounds.x, petY: bounds.y });
  });
  petWin.on("closed", () => {
    petWin = null;
  });
}

function syncPetWindow(enabled) {
  if (enabled) createPetWindow();
  else if (petWin) {
    petWin.destroy();
    petWin = null;
  }
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    applyMode("collapsed");
    win.webContents.send("max:collapse");
  } else {
    win.showInactive();
  }
}

function createTray() {
  const iconPath = path.join(ROOT, "assets", "icon.png");
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("MAX — desktop companion");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open MAX", click: () => { win?.showInactive(); applyMode("expanded"); win?.webContents.send("max:palette"); } },
      { label: "Command palette", accelerator: "CommandOrControl+Shift+Space", click: () => { win?.showInactive(); applyMode("expanded"); win?.webContents.send("max:palette"); } },
      { type: "separator" },
      {
        label: "Pet on desktop",
        type: "checkbox",
        checked: true,
        click: (item) => syncPetWindow(item.checked),
      },
      {
        label: "Always on top",
        type: "checkbox",
        checked: true,
        click: (item) => {
          win?.setAlwaysOnTop(item.checked, item.checked ? "screen-saver" : "normal");
        },
      },
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
      },
      { label: "Open settings folder", click: () => shell.openPath(app.getPath("userData")) },
      { type: "separator" },
      { label: "Quit MAX", click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on("click", () => {
    win?.showInactive();
    applyMode("expanded");
    win?.webContents.send("max:palette");
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    win?.showInactive();
    applyMode("expanded");
    win?.webContents.send("max:palette");
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("dev.max.companion");
    await startServer();
    createWindow();
    createTray();

    try {
      const state = await (await fetch(`${BASE_URL}/api/state`, { signal: AbortSignal.timeout(2500) })).json();
      if (state?.config?.prefs?.petOnDesktop !== false) createPetWindow();
    } catch {
      createPetWindow();
    }

    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      win?.showInactive();
      if (currentMode === "expanded") {
        applyMode("collapsed");
      } else {
        applyMode("expanded");
        win?.webContents.send("max:palette");
      }
    });

    ipcMain.on("max:mode", (_event, mode) => {
      applyMode(mode === "expanded" ? "expanded" : "collapsed");
    });

    ipcMain.on("max:hide", () => win?.hide());

    ipcMain.on("max:open-island", () => {
      win?.showInactive();
      applyMode("expanded");
      win?.webContents.send("max:palette");
    });

    ipcMain.on("max:pet-window", (_event, enabled) => syncPetWindow(Boolean(enabled)));
    ipcMain.on("max:quit", () => {
      quitting = true;
      app.quit();
    });

    app.on("activate", () => {
      if (!win) createWindow();
      win?.showInactive();
    });
  });

  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    globalShortcut.unregisterAll();
  });
}
