import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getAgentSession } from "./sessions.mjs";
import { AGENT_PROVIDERS } from "./protocol.mjs";

const MAX_REPLY_CHARS = 3000;
const PREVIEW_TTL_MS = 60_000;
const previews = new Map();

// Direct submission is enabled only for documented non-interactive resume forms.
// Claude Code and Cursor Agent remain copy-only until their current CLI contracts
// are verified; do not guess flags for a user-facing action.
const ADAPTERS = Object.freeze({
  codex: { executables: ["codex.exe"], args: (id, text) => ["exec", "resume", id, text] },
  "gemini-cli": { executables: ["gemini.exe"], args: (id, text) => ["--resume", id, "--prompt", text] },
});

function validText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_REPLY_CHARS && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function validSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

export function findAgentCli(provider, { env = process.env, platform = process.platform } = {}) {
  const adapter = ADAPTERS[provider];
  if (!adapter) return null;
  const pathList = String(env.PATH ?? env.Path ?? "").split(path.delimiter);
  for (const folder of pathList) {
    if (!folder) continue;
    for (const executable of adapter.executables) {
      const candidate = path.resolve(folder, executable);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        if (platform !== "win32" && (stat.mode & 0o111) === 0) continue;
        return fs.realpathSync(candidate);
      } catch { /* keep searching PATH */ }
    }
  }
  return null;
}

export function replyArguments(provider, sessionId, text) {
  if (!AGENT_PROVIDERS.includes(provider) || !validSessionId(sessionId) || !validText(text)) return null;
  const adapter = ADAPTERS[provider];
  return adapter ? adapter.args(sessionId, text) : null;
}

function prunePreviews(now) {
  for (const [id, preview] of previews) if (preview.expiresAt <= now) previews.delete(id);
  while (previews.size > 100) previews.delete(previews.keys().next().value);
}

/** Preview is bound to one current, unanswered question and expires quickly. */
export function prepareAgentReply({ provider, sessionId, requestId, text }, now = Date.now()) {
  prunePreviews(now);
  if (!AGENT_PROVIDERS.includes(provider) || !validSessionId(sessionId) || (requestId && !validSessionId(requestId)) || !validText(text)) {
    return { ok: false, message: "Check the message and try again (maximum 3,000 characters)." };
  }
  const session = getAgentSession(provider, sessionId, now);
  const followup = !requestId;
  const waitingQuestion = session?.status === "waiting" && session.pending?.type === "question" && session.pending.requestId === requestId;
  if (!session || (followup ? session.status !== "finished" || session.pending : !waitingQuestion)) {
    return { ok: false, message: "That question or session changed. Refresh sessions before sending anything." };
  }
  const id = crypto.randomBytes(24).toString("base64url");
  const expiresAt = now + PREVIEW_TTL_MS;
  previews.set(id, { provider, sessionId, requestId: requestId || null, followup, text, expiresAt });
  const executable = findAgentCli(provider);
  return {
    ok: true,
    confirmationId: id,
    provider,
    sessionId,
    project: session.project,
    title: session.title,
    text,
    expiresAt,
    mode: executable ? "resume-cli" : "copy-only",
    intent: followup ? "follow-up" : "question-reply",
    message: executable
      ? `Confirm to ${followup ? "resume" : "reply to"} this session with your exact text. The agent may use its own configured tools and permissions.`
      : "A direct agent executable was not found. MAX will not use a shell wrapper; copy the text into the agent yourself.",
  };
}

/** Consume once, revalidate the pending question, and spawn an allowlisted executable with shell=false. */
export async function confirmAgentReply(confirmationId, now = Date.now()) {
  prunePreviews(now);
  const preview = previews.get(confirmationId);
  if (!preview) return { ok: false, message: "That reply preview expired or was already used. Review it again." };
  previews.delete(confirmationId);
  const session = getAgentSession(preview.provider, preview.sessionId, now);
  const stillWaiting = preview.requestId && session?.status === "waiting" && session.pending?.type === "question" && session.pending.requestId === preview.requestId;
  const stillFinished = preview.followup && session?.status === "finished" && !session.pending;
  if (!session || (!stillWaiting && !stillFinished)) {
    return { ok: false, message: "That question or session changed after your preview. Nothing was sent; review the latest state." };
  }
  const executable = findAgentCli(preview.provider);
  const args = replyArguments(preview.provider, preview.sessionId, preview.text);
  if (!executable || !args) return { ok: true, mode: "copy-only", message: "No direct executable was started. Copy this text into the agent yourself." };

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: "ignore", detached: process.platform !== "win32" });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("The agent process did not start in time."));
      }, 5000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("spawn", () => {
        clearTimeout(timer);
        child.unref();
        resolve();
      });
    });
    return { ok: true, message: `Reply sent to ${preview.provider}. MAX did not approve any tool permissions.` };
  } catch {
    return { ok: false, message: "MAX couldn't start the agent safely. Nothing was sent; copy the reply into the agent instead." };
  }
}

/** Test-only reset. */
export function resetReplyPreviews() {
  previews.clear();
}
