export interface MaxShellBridge {
  isDesktop: boolean;
  platform: string;
  setMode: (mode: "collapsed" | "expanded") => void;
  hide: () => void;
  quit: () => void;
  openIsland: () => void;
  setPetWindow: (enabled: boolean) => void;
  onOpenPalette: (callback: () => void) => () => void;
  onCollapse: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    maxShell?: MaxShellBridge;
  }
}

export const shellBridge = (): MaxShellBridge | undefined =>
  typeof window === "undefined" ? undefined : window.maxShell;

export const inDesktopShell = (): boolean => Boolean(shellBridge()?.isDesktop);
