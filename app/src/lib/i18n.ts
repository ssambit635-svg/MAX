/**
 * Small translation layer.
 *
 * There is no runtime download and no machine translation: a few dozen strings
 * ship in this file, one dictionary per language. Anything missing falls back to
 * English, so a half-translated language never shows a blank label.
 *
 * Adding a language means adding one entry to DICTIONARIES — nothing else.
 */

export type Language = "en" | "hi";

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी (Hinglish)" },
];

type Key =
  | "tab.now"
  | "tab.code"
  | "tab.stats"
  | "tab.actions"
  | "tab.settings"
  | "island.ask"
  | "island.poke"
  | "mood.idle"
  | "mood.listening"
  | "mood.thinking"
  | "mood.working"
  | "mood.happy"
  | "mood.sleepy"
  | "mood.error"
  | "mood.celebrate"
  | "action.open"
  | "action.save"
  | "action.copy"
  | "empty.notes"
  | "empty.activity";

const DICTIONARIES: Record<Language, Partial<Record<Key, string>>> = {
  en: {},
  hi: {
    "tab.now": "अभी",
    "tab.code": "कोड",
    "tab.stats": "आँकड़े",
    "tab.actions": "काम",
    "tab.settings": "सेटिंग",
    "island.ask": "कुछ भी पूछो…",
    "island.poke": "कुछ करना है?",
    "mood.idle": "बोलो, क्या करना है",
    "mood.listening": "सुन रहा हूँ",
    "mood.thinking": "देख रहा हूँ",
    "mood.working": "काम चालू है",
    "mood.happy": "हो गया",
    "mood.sleepy": "आराम कर रहा हूँ",
    "mood.error": "मदद चाहिए",
    "mood.celebrate": "बढ़िया",
    "action.open": "खोलो",
    "action.save": "सेव",
    "action.copy": "कॉपी",
    "empty.notes": "अभी कोई नोट नहीं",
    "empty.activity": "अभी कुछ नहीं हुआ",
  },
};

const FALLBACK: Record<Key, string> = {
  "tab.now": "Now",
  "tab.code": "Code",
  "tab.stats": "Stats",
  "tab.actions": "Actions",
  "tab.settings": "Settings",
  "island.ask": "Ask me anything…",
  "island.poke": "Need something?",
  "mood.idle": "ready when you are",
  "mood.listening": "listening",
  "mood.thinking": "working on it",
  "mood.working": "in focus",
  "mood.happy": "on it",
  "mood.sleepy": "resting",
  "mood.error": "needs a hand",
  "mood.celebrate": "nice one",
  "action.open": "Open",
  "action.save": "Save",
  "action.copy": "Copy",
  "empty.notes": "No notes yet",
  "empty.activity": "Nothing here yet",
};

let current: Language = "en";

export const setLanguage = (language: string | undefined) => {
  current = language === "hi" ? "hi" : "en";
  if (typeof document !== "undefined") document.documentElement.lang = language === "hi" ? "hi" : "en";
  return current;
};

export const getLanguage = (): Language => current;

/** Translate one key; `vars` fills `{name}` slots. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[current][key] ?? FALLBACK[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? `{${name}}`));
}

/** For tests and the Settings panel: how complete each language is. */
export const coverage = () => {
  const total = Object.keys(FALLBACK).length;
  return LANGUAGES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    translated: Object.keys(DICTIONARIES[entry.id]).length,
    total,
  }));
};
