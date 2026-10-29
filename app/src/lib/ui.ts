import { t } from "./i18n";
import type { Mood, Tab } from "./types";

/** The five tabs, in the order they appear in the island header. */
export const TABS: { id: Tab }[] = [{ id: "now" }, { id: "code" }, { id: "stats" }, { id: "actions" }, { id: "settings" }];

/** Tab label in the current language. */
export const tabLabel = (id: Tab): string => t(`tab.${id}` as const);

/** One short line per mood — used under the pet and in the pill. */
export const moodLine = (mood: Mood): string => t(`mood.${mood}` as const);

/** True inside the Electron shell, or when the browser preview asks for it. */
export const isDesktopShell = (): boolean =>
  typeof window !== "undefined" &&
  (Boolean(window.maxShell?.isDesktop) || new URLSearchParams(window.location.search).get("shell") === "desktop");
