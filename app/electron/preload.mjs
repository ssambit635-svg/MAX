import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("maxShell", {
  isDesktop: true,
  platform: process.platform,
  setMode: (mode) => ipcRenderer.send("max:mode", mode),
  quit: () => ipcRenderer.send("max:quit"),
  dragBegin: (screenX, screenY) => ipcRenderer.send("max:drag-begin", { screenX, screenY }),
  dragMove: (screenX, screenY) => ipcRenderer.send("max:drag-move", { screenX, screenY }),
  dragEnd: () => ipcRenderer.send("max:drag-end"),
  openExternal: (url) => ipcRenderer.send("max:open-external", url),
  setLoginItem: (enabled) => ipcRenderer.send("max:login-item", Boolean(enabled)),
  setAlwaysOnTop: (enabled) => ipcRenderer.send("max:always-on-top", Boolean(enabled)),
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
