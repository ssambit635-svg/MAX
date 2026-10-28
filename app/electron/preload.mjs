import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("maxShell", {
  isDesktop: true,
  platform: process.platform,
  setMode: (mode) => ipcRenderer.send("max:mode", mode),
  hide: () => ipcRenderer.send("max:hide"),
  quit: () => ipcRenderer.send("max:quit"),
  openIsland: () => ipcRenderer.send("max:open-island"),
  setPetWindow: (enabled) => ipcRenderer.send("max:pet-window", enabled),
  onOpenPalette: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("max:palette", handler);
    return () => ipcRenderer.removeListener("max:palette", handler);
  },
  onCollapse: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("max:collapse", handler);
    return () => ipcRenderer.removeListener("max:collapse", handler);
  },
});
