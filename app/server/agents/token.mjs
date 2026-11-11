import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../store.mjs";

const TOKEN_FILE = path.join(STATE_DIR, "agent-hook-token");
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Stable per-install secret for local agent lifecycle hooks; never return it to the renderer. */
function agentHookToken() {
  try {
    const stat = fs.lstatSync(TOKEN_FILE);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Agent hook token path is not a regular file.");
    const existing = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (TOKEN_PATTERN.test(existing)) return existing;
    throw new Error("Agent hook token file is malformed.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // First run: create an owner-only token; never follow an existing link.
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const token = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(TOKEN_FILE, `${token}\n`, { flag: "wx", mode: 0o600 });
    return token;
  } catch (error) {
    // Another service process may have won the create race.
    try {
      const stat = fs.lstatSync(TOKEN_FILE);
      if (!stat.isFile() || stat.isSymbolicLink()) throw error;
      const existing = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      if (TOKEN_PATTERN.test(existing)) return existing;
    } catch {
      /* return no implicit fallback secret */
    }
    throw error;
  }
}

export function validAgentHookAuthorization(header) {
  const supplied = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!TOKEN_PATTERN.test(supplied)) return false;
  try {
    const expected = agentHookToken();
    return crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** Write runtime coordinates for locally installed provider hooks. Token never enters renderer/API responses. */
export function publishAgentRuntime(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local service port.");
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const token = agentHookToken();
  const target = path.join(STATE_DIR, "agent-runtime.json");
  const temp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ port }), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  return token;
}
