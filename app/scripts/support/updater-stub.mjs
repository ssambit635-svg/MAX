/** A silent stand-in for electron-updater: a test must never check for updates. */
export const autoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  currentVersion: { version: "0.0.0-test" },
  on: () => autoUpdater,
  once: () => autoUpdater,
  checkForUpdates: async () => ({ updateInfo: null }),
  downloadUpdate: async () => [],
  quitAndInstall: () => undefined,
  setFeedURL: () => undefined,
};
export default { autoUpdater };
