import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../store.mjs";

const TOKEN_FILE = path.join(STATE_DIR, "agent-hook-token");
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Stable per-install secret for local agent lifecycle hooks; never return it to the renderer. */
function agentHookToken() {
  try {
    const existing = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (TOKEN_PATTERN.test(existing)) return existing;
  } catch {
    // First run or unreadable file: attempt an atomic, owner-only create below.
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const token = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(TOKEN_FILE, `${token}\n`, { flag: "wx", mode: 0o600 });
    return token;
  } catch (error) {
    // Another service process may have won the create race.
    try {
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
  const expected = agentHookToken();
  return crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}
