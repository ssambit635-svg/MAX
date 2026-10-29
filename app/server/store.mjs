import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeFolder } from "./paths.mjs";
import { PERSONAL_PRESET, presetEnabled } from "./personal.mjs";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_DIR = process.env.MAX_STATE_DIR ?? path.join(APP_ROOT, ".max");
export const CONFIG_FILE = path.join(STATE_DIR, "config.json");
const ACTIVITY_FILE = path.join(STATE_DIR, "activity.json");

const DEFAULT_CONFIG = {
  version: 1,
  saveDir: path.join(os.homedir(), "Documents", "MAX notes"),
  codeDir: path.join(os.homedir(), "Documents", "MAX code"),
  github: { username: "", token: "" },
  leetcode: { username: "" },
  render: { apiKey: "" },
  /** User-defined launchers: { name, path } — see server/apps.mjs. */
  customApps: [],
  prefs: {
    launchAtLogin: false,
    alwaysOnTop: true,
    reduceMotion: false,
    keepIslandOpen: false,
    idleSleepSeconds: 120,
    language: "en",
    lastSeenVersion: "",
  },
};

const LANGUAGES = new Set(["en", "hi"]);

/** Anything true-ish becomes true; everything else false. */
const asBool = (value, fallback) => (typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : fallback);
const asText = (value, fallback = "") => (typeof value === "string" ? value.slice(0, 400) : fallback);
const asNumber = (value, fallback, min, max) => {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
};

/**
 * A config file is a text file on somebody's disk, and an old version wrote it.
 * Every field is repaired here instead of trusted: a bad value must never reach
 * the rest of the app as NaN, "yes", or a folder that belongs to the OS.
 */
function sanitiseConfig(raw) {
  const defaults = structuredClone(DEFAULT_CONFIG);
  const input = raw && typeof raw === "object" ? raw : {};
  const prefs = input.prefs && typeof input.prefs === "object" ? input.prefs : {};

  return {
    version: 1,
    saveDir: safeFolder(input.saveDir) ?? defaults.saveDir,
    codeDir: safeFolder(input.codeDir) ?? defaults.codeDir,
    github: {
      username: asText(input.github?.username).trim(),
      token: asText(input.github?.token, "").slice(0, 200).trim(),
    },
    leetcode: { username: asText(input.leetcode?.username).trim() },
    render: { apiKey: asText(input.render?.apiKey, "").slice(0, 200).trim() },
    customApps: Array.isArray(input.customApps)
      ? input.customApps
          .filter((entry) => entry && typeof entry.name === "string" && typeof entry.path === "string")
          .slice(0, 40)
          .map((entry) => ({ name: asText(entry.name).slice(0, 40), path: asText(entry.path, "").slice(0, 600) }))
          .filter((entry) => entry.name && entry.path)
      : [],
    prefs: {
      launchAtLogin: asBool(prefs.launchAtLogin, defaults.prefs.launchAtLogin),
      alwaysOnTop: asBool(prefs.alwaysOnTop, defaults.prefs.alwaysOnTop),
      reduceMotion: asBool(prefs.reduceMotion, defaults.prefs.reduceMotion),
      keepIslandOpen: asBool(prefs.keepIslandOpen, defaults.prefs.keepIslandOpen),
      idleSleepSeconds: asNumber(prefs.idleSleepSeconds, defaults.prefs.idleSleepSeconds, 10, 3600),
      language: LANGUAGES.has(prefs.language) ? prefs.language : defaults.prefs.language,
      lastSeenVersion: asText(prefs.lastSeenVersion).slice(0, 20),
    },
    ...(input.preset ? { preset: input.preset } : {}),
  };
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
}

/** Keys that would rewrite a prototype instead of setting a value. */
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = Array.isArray(base) ? [...base] : { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(base?.[key], value)
      : value;
  }
  return out;
}

/** First run only: seed the owner's public handles so MAX arrives pre-connected. */
function seedConfig() {
  const seeded = structuredClone(DEFAULT_CONFIG);
  if (presetEnabled()) {
    seeded.github = { ...seeded.github, username: PERSONAL_PRESET.github.username };
    seeded.leetcode = { ...seeded.leetcode, username: PERSONAL_PRESET.leetcode.username };
    seeded.preset = { applied: true, owner: PERSONAL_PRESET.owner };
  }
  return seeded;
}

export function loadConfig() {
  ensureDir(STATE_DIR);
  if (!fs.existsSync(CONFIG_FILE)) {
    const seeded = seedConfig();
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(seeded, null, 2), { mode: 0o600 });
    } catch {
      /* read-only disk: the in-memory defaults still work */
    }
    return seeded;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return sanitiseConfig(deepMerge(DEFAULT_CONFIG, JSON.parse(raw)));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(patch) {
  ensureDir(STATE_DIR);
  // Merge, then repair: whatever the caller sent, what lands on disk is valid.
  const next = sanitiseConfig(deepMerge(loadConfig(), patch ?? {}));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

/** Config as the UI should see it: secrets are reduced to "is it set". */
export function publicConfig(config = loadConfig()) {
  return {
    saveDir: config.saveDir,
    codeDir: config.codeDir,
    prefs: config.prefs,
    github: { username: config.github.username, connected: Boolean(config.github.token || config.github.username) },
    leetcode: { username: config.leetcode.username, connected: Boolean(config.leetcode.username) },
    render: { connected: Boolean(config.render.apiKey) },
    customApps: (config.customApps ?? []).map((app) => ({ name: app.name })),
    preset: config.preset?.applied ? { applied: true, owner: config.preset.owner } : { applied: false },
  };
}

export function loadActivity() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACTIVITY_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(0, 60) : [];
  } catch {
    return [];
  }
}

export function appendActivity(entry) {
  const list = loadActivity();
  list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), ...entry });
  const trimmed = list.slice(0, 60);
  ensureDir(STATE_DIR);
  try {
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(trimmed, null, 2));
  } catch {
    /* the activity log is best effort */
  }
  return trimmed;
}

