/**
 * A stand-in for `electron`, so the real main process can be run in Node.
 *
 * Nothing here ships: it exists so `verify-shell.test.mjs` can load the true
 * `electron/main.mjs`, trigger the app lifecycle, and drive every IPC channel.
 * Before this, the shell was only ever checked for syntax — which is how a
 * `cancelTween is not defined` reached an installed build.
 */

export const state = {
  ready: false,
  readyCallbacks: [],
  quitCalled: false,
  lockGranted: true,
  loginItem: { openAtLogin: false },
  userData: "",
  version: "0.0.0-test",
  windows: [],
  channels: new Map(),
  handlers: new Map(),
  shortcuts: [],
  trayMenus: [],
  external: [],
  logs: [],
  dialogs: [],
  /** Set by tests: force the next BrowserWindow to misbehave. */
  failOn: null,
};

const listeners = new Map();
const emit = (event, ...args) => {
  for (const listener of listeners.get(event) ?? []) {
    try {
      listener(...args);
    } catch (error) {
      state.logs.push(`listener for ${event} threw: ${error?.message}`);
      throw error;
    }
  }
};

export const app = {
  getVersion: () => state.version,
  isReady: () => state.ready,
  getPath: (name) => (name === "userData" ? state.userData : state.userData),
  isPackaged: false,
  requestSingleInstanceLock: () => state.lockGranted,
  setAppUserModelId: () => undefined,
  whenReady: () => {
    state.ready = true;
    return {
      then: (callback) => {
        state.readyCallbacks.push(callback);
        // Run after the module has finished evaluating, like the real thing.
        queueMicrotask(() => {
          Promise.resolve(callback()).catch((error) => state.readyError = error);
        });
        return { catch: () => undefined };
      },
      catch: () => undefined,
    };
  },
  once: (event, listener) => app.on(event, listener),
  quit: () => {
    state.quitCalled = true;
  },
  getLoginItemSettings: () => state.loginItem,
  setLoginItemSettings: (settings) => {
    state.loginItem = settings;
  },
  getAppPath: () => process.cwd(),
  on: (event, listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    return app;
  },
};

class Emitter {
  #events = new Map();
  on(event, listener) {
    this.#events.set(event, [...(this.#events.get(event) ?? []), listener]);
    return this;
  }
  once(event, listener) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }
  removeListener(event, listener) {
    this.#events.set(event, (this.#events.get(event) ?? []).filter((entry) => entry !== listener));
    return this;
  }
  emit(event, ...args) {
    for (const listener of this.#events.get(event) ?? []) listener(...args);
  }
  listenerCount(event) {
    return (this.#events.get(event) ?? []).length;
  }
}

export class BrowserWindow extends Emitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 336, height: options.height ?? 64 };
    this.visible = false;
    this.destroyed = false;
    this.resizable = true;
    this.alwaysOnTop = Boolean(options.alwaysOnTop);
    this.loaded = [];
    this.sent = [];
    this.webContents = new Emitter();
    this.webContents.send = (channel, payload) => this.sent.push({ channel, payload });
    this.webContents.executeJavaScript = async () => undefined;
    this.webContents.setWindowOpenHandler = (handler) => {
      this.openHandler = handler;
    };
    this.webContents.on = (event, listener) => {
      Emitter.prototype.on.call(this.webContents, event, listener);
      return this.webContents;
    };
    state.windows.push(this);
  }

  getBounds() {
    if (state.failOn === "getBounds") throw new Error("getBounds exploded");
    return { ...this.bounds };
  }
  setBounds(next) {
    if (state.failOn === "setBounds") throw new Error("setBounds exploded");
    this.bounds = { ...this.bounds, ...next };
  }
  setPosition(x, y) {
    this.bounds = { ...this.bounds, x, y };
  }
  setSize(width, height) {
    this.bounds = { ...this.bounds, width, height };
  }
  getPosition() {
    return [this.bounds.x, this.bounds.y];
  }
  isVisible() {
    return this.visible;
  }
  showInactive() {
    this.visible = true;
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isResizable() {
    return this.resizable;
  }
  setResizable(value) {
    this.resizable = value;
  }
  setAlwaysOnTop(value) {
    this.alwaysOnTop = value;
  }
  setVisibleOnAllWorkspaces() {}
  setIgnoreMouseEvents() {}
  setSkipTaskbar() {}
  loadURL(url) {
    this.loaded.push(url);
  }
  loadFile(file) {
    this.loaded.push(file);
  }
  focus() {}
  close() {
    this.destroyed = true;
    this.emit("closed");
  }
  static getAllWindows() {
    return state.windows.filter((window) => !window.destroyed);
  }
}

export const ipcMain = {
  on: (channel, handler) => state.channels.set(channel, handler),
  handle: (channel, handler) => state.handlers.set(channel, handler),
  removeHandler: (channel) => state.handlers.delete(channel),
  removeAllListeners: (channel) => state.channels.delete(channel),
};

export const screen = {
  getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  getCursorScreenPoint: () => ({ x: 720, y: 20 }),
  getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }],
};

export const shell = {
  openExternal: (url) => state.external.push(url),
  openPath: async () => "",
};

export const globalShortcut = {
  register: (accelerator, callback) => {
    state.shortcuts.push({ accelerator, callback });
    return true;
  },
  unregisterAll: () => {
    state.shortcuts = [];
  },
};

export const dialog = {
  showErrorBox: (title, content) => state.dialogs.push({ title, content }),
  showMessageBox: async () => ({ response: 0 }),
};

export const nativeImage = {
  createFromPath: () => ({ resize: () => ({ isEmpty: () => false }) }),
  createEmpty: () => ({ resize: () => ({ isEmpty: () => true }) }),
};

export class Tray extends Emitter {
  constructor(icon) {
    super();
    this.icon = icon;
    this.tooltip = "";
    this.menu = null;
    state.tray = this;
  }
  setToolTip(text) {
    this.tooltip = text;
  }
  setContextMenu(menu) {
    this.menu = menu;
    state.trayMenus.push(menu);
  }
  destroy() {}
}

export const Menu = {
  buildFromTemplate: (template) => ({ template }),
  setApplicationMenu: () => undefined,
};

export const session = { defaultSession: { webRequest: { onHeadersReceived: () => undefined } } };
export default { app, BrowserWindow, ipcMain, screen, shell, globalShortcut, dialog, nativeImage, Tray, Menu, session };
