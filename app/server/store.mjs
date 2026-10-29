import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL_PRESET, presetEnabled } from "./personal.mjs";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_DIR = process.env.MAX_STATE_DIR ?? path.join(APP_ROOT, ".max");
const CONFIG_FILE = path.join(STATE_DIR, "config.json");
const ACTIVITY_FILE = path.join(STATE_DIR, "activity.json");

const DEFAULT_CONFIG = {
  version: 1,
  saveDir: path.join(os.homedir(), "Documents", "MAX notes"),
  codeDir: path.join(os.homedir(), "Documents", "MAX code"),
  github: { username: "", token: "" },
  leetcode: { username: "" },
  render: { apiKey: "" },
  prefs: {
    launchAtLogin: false,
    reduceMotion: false,
    keepIslandOpen: false,
    idleSleepSeconds: 120,
  },
};

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
}

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = Array.isArray(base) ? [...base] : { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
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
    return deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(patch) {
  ensureDir(STATE_DIR);
  const next = deepMerge(loadConfig(), patch ?? {});
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

export { DEFAULT_CONFIG };
