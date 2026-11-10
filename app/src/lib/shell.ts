export interface MaxShellBridge {
  isDesktop: boolean;
  platform: string;
  setMode: (mode: "collapsed" | "expanded", height?: number) => void;
  quit: () => void;
  dragBegin: (screenX: number, screenY: number) => void;
  dragMove: (screenX: number, screenY: number) => void;
  dragEnd: () => void;
  openExternal: (url: string) => void;
  chooseProjectFolder: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; message?: string }>;
  openProjectFolder: (folder: string) => Promise<{ ok: boolean; message?: string }>;
  setLoginItem: (enabled: boolean) => void;
  updateStatus: () => Promise<{ state: string; version: string | null; message: string }>;
  checkForUpdates: () => void;
  installUpdate: () => void;
  onUpdate: (callback: (status: { state: string; version: string | null; message: string }) => void) => () => void;
  setAlwaysOnTop: (enabled: boolean) => void;
  onOpenPalette: (callback: () => void) => () => void;
  onCapture?: (callback: () => void) => () => void;
  onShellError?: (callback: (payload: { channel: string; message: string }) => void) => () => void;
  onCollapse: (callback: () => void) => () => void;
  onPrefChanged: (callback: (prefs: { launchAtLogin?: boolean; alwaysOnTop?: boolean }) => void) => () => void;
}

declare global {
  interface Window {
    maxShell?: MaxShellBridge;
  }
}

export const shellBridge = (): MaxShellBridge | undefined =>
  typeof window === "undefined" ? undefined : window.maxShell;
