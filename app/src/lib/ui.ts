import type { Mood, Tab } from "./types";

/** The five tabs, in the order they appear in the island header. */
export const TABS: { id: Tab; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "code", label: "Code" },
  { id: "stats", label: "Stats" },
  { id: "actions", label: "Actions" },
  { id: "settings", label: "Settings" },
];

/** One short line per mood — used under the pet and in the pill. */
export const MOOD_COPY: Record<Mood, string> = {
  idle: "ready when you are",
  listening: "listening",
  thinking: "working on it",
  working: "in focus",
  happy: "on it",
  sleepy: "resting",
  error: "needs a hand",
  celebrate: "nice one",
};

/** True inside the Electron shell, or when the browser preview asks for it. */
export const isDesktopShell = (): boolean =>
  typeof window !== "undefined" &&
  (Boolean(window.maxShell?.isDesktop) || new URLSearchParams(window.location.search).get("shell") === "desktop");
