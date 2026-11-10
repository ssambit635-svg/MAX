import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_PROVIDERS } from "./protocol.mjs";

const MARKER = "MAX_AGENT_HOOK_V1";
const WINDOWS_COMMAND_PROCESSOR = ["cmd", "exe"].join(".");
const PROVIDER_EVENTS = Object.freeze({
  "claude-code": ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd"],
  codex: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd"],
  cursor: ["sessionStart", "beforeSubmitPrompt", "preToolUse", "postToolUse", "postToolUseFailure", "stop", "sessionEnd"],
  "gemini-cli": ["SessionStart", "BeforeAgent", "BeforeTool", "AfterTool", "AfterAgent", "SessionEnd"],
});

const PROVIDER_PATHS = Object.freeze({
  "claude-code": (home) => path.join(home, ".claude", "settings.json"),
  codex: (home) => path.join(home, ".codex", "hooks.json"),
  cursor: (home) => path.join(home, ".cursor", "hooks.json"),
  "gemini-cli": (home) => path.join(home, ".gemini", "settings.json"),
});

export function agentProviderInfo(home = os.homedir()) {
  return AGENT_PROVIDERS.map((provider) => ({
    provider,
    settingsPath: PROVIDER_PATHS[provider](home),
    events: PROVIDER_EVENTS[provider],
  }));
}

function commandFor(provider, event, hookCommand) {
  const suffix = `--provider ${provider} --event ${event} --max-hook-marker ${MARKER}`;
  return hookCommand.startsWith(`${WINDOWS_COMMAND_PROCESSOR} `) ? `${hookCommand.slice(0, -1)} ${suffix}\"` : `${hookCommand} ${suffix}`;
}

function removeOurs(entries) {
  return entries.filter((entry) => !JSON.stringify(entry).includes(MARKER));
}

function addGroupedHooks(root, provider, hookCommand) {
  const hooks = root.hooks === undefined ? {} : root.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error("The hooks setting is not an object; MAX left it untouched.");
  root.hooks = hooks;
  for (const event of PROVIDER_EVENTS[provider]) {
    const current = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(current)) throw new Error(`The ${event} hook setting is not a list; MAX left it untouched.`);
    const groups = current.map((group) => {
      if (!Array.isArray(group?.hooks)) return group;
      const next = removeOurs(group.hooks);
      return next.length ? { ...group, hooks: next } : null;
    }).filter(Boolean);
    const command = commandFor(provider, event, hookCommand);
    if (provider === "codex") {
      groups.push({ hooks: [{ type: "command", command, timeout: event === "PermissionRequest" ? 120 : 10 }] });
    } else {
      groups.push({ matcher: "*", hooks: [{ type: "command", command, timeout: event === "PermissionRequest" ? 120 : 10 }] });
    }
    hooks[event] = groups;
  }
  return root;
}

function addCursorHooks(root, hookCommand) {
  if (root.version !== undefined && root.version !== 1) throw new Error("Cursor uses an unsupported hooks.json version; MAX left it untouched.");
  const hooks = root.hooks === undefined ? {} : root.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error("Cursor's hooks setting is not an object; MAX left it untouched.");
  root.version = 1;
  root.hooks = hooks;
  for (const event of PROVIDER_EVENTS.cursor) {
    const current = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(current)) throw new Error(`Cursor's ${event} hook setting is not a list; MAX left it untouched.`);
    hooks[event] = [...removeOurs(current), { command: commandFor("cursor", event, hookCommand) }];
  }
  return root;
}

function removeGroupedHooks(root, provider) {
  if (!root.hooks || typeof root.hooks !== "object" || Array.isArray(root.hooks)) return root;
  for (const event of PROVIDER_EVENTS[provider]) {
    const list = root.hooks[event];
    if (!Array.isArray(list)) continue;
    const next = list.map((group) => {
      if (!Array.isArray(group?.hooks)) return group;
      const remaining = removeOurs(group.hooks);
      return remaining.length ? { ...group, hooks: remaining } : null;
    }).filter(Boolean);
    if (next.length) root.hooks[event] = next;
    else delete root.hooks[event];
  }
  if (Object.keys(root.hooks).length === 0) delete root.hooks;
  return root;
}

function removeCursorHooks(root) {
  if (!root.hooks || typeof root.hooks !== "object" || Array.isArray(root.hooks)) return root;
  for (const event of PROVIDER_EVENTS.cursor) {
    const list = root.hooks[event];
    if (!Array.isArray(list)) continue;
    const next = removeOurs(list);
    if (next.length) root.hooks[event] = next;
    else delete root.hooks[event];
  }
  if (!Object.keys(root.hooks).length) delete root.hooks;
  if (root.version === 1 && !root.hooks) delete root.version;
  return root;
}

export function editAgentHookConfig(provider, text, { command, uninstall = false } = {}) {
  if (!AGENT_PROVIDERS.includes(provider)) throw new Error("Unknown coding agent.");
  let root = {};
  if (text) {
    try { root = JSON.parse(text); } catch { throw new Error("The agent settings file contains invalid JSON; MAX left it untouched."); }
    if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("The agent settings root is not an object; MAX left it untouched.");
  }
  root = structuredClone(root);
  if (uninstall) {
    root = provider === "cursor" ? removeCursorHooks(root) : removeGroupedHooks(root, provider);
  } else {
    if (typeof command !== "string" || !command.trim() || command.length > 1500) throw new Error("MAX could not build a valid local hook command.");
    root = provider === "cursor" ? addCursorHooks(root, command) : addGroupedHooks(root, provider, command);
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

function quotePosix(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function quoteCmd(value) {
  const text = String(value);
  if (/[\r\n"%!&|<>^]/.test(text)) throw new Error("MAX cannot safely install a hook when a path contains shell-control characters.");
  return `"${text}"`;
}

export function buildHookCommand({ provider, event, nodePath, scriptPath, stateDir, platform = process.platform }) {
  if (!AGENT_PROVIDERS.includes(provider) || !PROVIDER_EVENTS[provider].includes(event)) throw new Error("Unknown agent hook event.");
  const isAbsolute = platform === "win32" ? path.win32.isAbsolute : path.isAbsolute;
  if (![nodePath, scriptPath, stateDir].every((value) => typeof value === "string" && isAbsolute(value))) throw new Error("MAX could not resolve an absolute hook path.");
  if (platform === "win32") return `${WINDOWS_COMMAND_PROCESSOR} /d /s /c "${quoteCmd(nodePath)} ${quoteCmd(scriptPath)} --state-dir ${quoteCmd(stateDir)}"`;
  return `${quotePosix(nodePath)} ${quotePosix(scriptPath)} --state-dir ${quotePosix(stateDir)}`;
}

export function hookPlanFingerprint(provider, source, target, action) {
  return crypto.createHash("sha256").update(`${provider}\0${action}\0${source ?? ""}\0${target}`).digest("hex");
}

function redactSettings(value) {
  if (Array.isArray(value)) return value.map(redactSettings);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /token|secret|password|api.?key|authorization|credential/i.test(key) ? "[hidden by MAX]" : redactSettings(item),
  ]));
}

export function previewDiff(source, target) {
  const serialize = (text) => {
    if (!text) return "{}\n";
    if (Buffer.byteLength(text) > 128_000) throw new Error("That settings file is too large for a safe preview. MAX left it untouched.");
    return `${JSON.stringify(redactSettings(JSON.parse(text)), null, 2)}\n`;
  };
  let before;
  let after;
  try { before = serialize(String(source ?? "")); after = serialize(String(target)); }
  catch (error) { throw new Error(error.message || "MAX could not safely preview those settings."); }
  const lines = ["--- current settings (secrets redacted)", "+++ proposed settings (secrets redacted)"];
  for (const line of before.split("\n")) lines.push(`-${line}`);
  for (const line of after.split("\n")) lines.push(`+${line}`);
  return lines.join("\n");
}


export function assertSafeAgentSettingsPath(file) {
  const resolved = path.resolve(file);
  let cursor = path.dirname(resolved);
  while (true) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("The agent settings folder contains a link or is not a directory. MAX refused to modify it.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("The agent settings path is not a regular file. MAX refused to modify it.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function writeAgentConfigAtomically(file, content, backupPath) {
  assertSafeAgentSettingsPath(file);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  assertSafeAgentSettingsPath(file);
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The agent settings path is not a regular file; MAX refused to modify it.");
    if (!fs.existsSync(backupPath)) fs.copyFileSync(file, backupPath, fs.constants.COPYFILE_EXCL);
  }
  const temp = `${file}.max-${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort cleanup */ }
    throw error;
  }
}

export { MARKER as AGENT_HOOK_MARKER };
