import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("maxShell", {
  isDesktop: true,
  platform: process.platform,
  setMode: (mode, height) => ipcRenderer.send("max:mode", { mode, height }),
  quit: () => ipcRenderer.send("max:quit"),
  dragBegin: (screenX, screenY) => ipcRenderer.send("max:drag-begin", { screenX, screenY }),
  dragMove: (screenX, screenY) => ipcRenderer.send("max:drag-move", { screenX, screenY }),
  dragEnd: () => ipcRenderer.send("max:drag-end"),
  openExternal: (url) => ipcRenderer.send("max:open-external", url),
  updateStatus: () => ipcRenderer.invoke("max:update-status"),
  checkForUpdates: () => ipcRenderer.send("max:update-check"),
  installUpdate: () => ipcRenderer.send("max:update-install"),
  onUpdate: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("max:update", handler);
    return () => ipcRenderer.removeListener("max:update", handler);
  },
  setLoginItem: (enabled) => ipcRenderer.send("max:login-item", Boolean(enabled)),
  setAlwaysOnTop: (enabled) => ipcRenderer.send("max:always-on-top", Boolean(enabled)),
  onShellError: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("max:shell-error", handler);
    return () => ipcRenderer.removeListener("max:shell-error", handler);
  },
  onCapture: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("max:capture", handler);
    return () => ipcRenderer.removeListener("max:capture", handler);
  },
  onOpenPalette: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("max:palette", handler);
    return () => ipcRenderer.removeListener("max:palette", handler);
  },
  onPrefChanged: (callback) => {
    const handler = (_event, prefs) => callback(prefs);
    ipcRenderer.on("max:pref-changed", handler);
    return () => ipcRenderer.removeListener("max:pref-changed", handler);
  },
  onCollapse: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("max:collapse", handler);
    return () => ipcRenderer.removeListener("max:collapse", handler);
  },
});
