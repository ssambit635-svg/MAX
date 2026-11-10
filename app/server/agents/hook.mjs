#!/usr/bin/env node
// Provider lifecycle adapter. Invoked only by an explicitly installed MAX hook.
// It forwards a small, normalized event to the local MAX service and fails closed.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeAgentEvent } from "./protocol.mjs";

const args = process.argv.slice(2);
const valueAfter = (name) => args[args.indexOf(name) + 1];
const provider = valueAfter("--provider");
const eventName = valueAfter("--event");
const stateDir = valueAfter("--state-dir");
const MAX_INPUT = 128 * 1024;

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (part) => {
      body += part;
      if (Buffer.byteLength(body) > MAX_INPUT) {
        reject(new Error("hook input too large"));
        process.stdin.destroy();
      }
    });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

export function translateAgentHookEvent(raw, provider = process.argv[process.argv.indexOf("--provider") + 1], eventName = process.argv[process.argv.indexOf("--event") + 1]) {
  const names = {
    "claude-code": { SessionStart: "session-start", UserPromptSubmit: "session-update", PreToolUse: "session-update", PermissionRequest: "permission-request", PostToolUse: "session-update", Stop: "session-finished", SessionEnd: "session-finished", Notification: "waiting-input" },
    codex: { SessionStart: "session-start", UserPromptSubmit: "session-update", PreToolUse: "session-update", PermissionRequest: "permission-request", PostToolUse: "session-update", Stop: "session-finished", SessionEnd: "session-finished" },
    cursor: { sessionStart: "session-start", beforeSubmitPrompt: "session-update", preToolUse: "session-update", postToolUse: "session-update", postToolUseFailure: "session-error", stop: "session-finished", sessionEnd: "session-finished" },
    "gemini-cli": { SessionStart: "session-start", BeforeAgent: "session-update", BeforeTool: "session-update", AfterTool: "session-update", AfterAgent: "session-finished", SessionEnd: "session-finished" },
  };
  const type = names[provider]?.[eventName];
  if (!type || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const toolName = String(raw.tool_name ?? raw.toolName ?? raw.tool?.name ?? "");
  const isQuestionTool = /askuserquestion|ask_user|userquestion/i.test(toolName);
  const actualType = isQuestionTool ? "question" : type;
  const requestId = raw.request_id ?? raw.requestId ?? raw.tool_use_id ?? raw.toolCallId;
  const question = raw.question ?? raw.message ?? raw.tool_input?.question ?? raw.toolInput?.question ?? raw.input?.question ?? "";
  const cwd = String(raw.cwd ?? raw.workspace_roots?.[0] ?? raw.workspaceRoot ?? "");
  const cleanCwd = cwd.replace(/[\\/]+$/, "");
  const project = cwd ? (cwd.includes("\\") ? path.win32.basename(cleanCwd) : path.basename(cleanCwd)) : "";
  const summary = raw.summary ?? raw.title ?? raw.tool_name ?? raw.toolName ?? "";
  return normalizeAgentEvent({
    provider,
    type: actualType,
    sessionId: raw.session_id ?? raw.sessionId ?? raw.conversation_id ?? raw.conversationId,
    requestId: actualType === "question" || actualType === "permission-request" ? requestId : undefined,
    project,
    title: summary,
    text: actualType === "question" || actualType === "permission-request" ? question : "",
    at: Date.now(),
  });
}

async function main() {
  if (!provider || !eventName || !stateDir) return;
  let payload;
  try { payload = JSON.parse(await readStdin()); } catch { return; }
  const event = translateAgentHookEvent(payload, provider, eventName);
  if (!event) return;
  let runtime;
  let token;
  try {
    runtime = JSON.parse(fs.readFileSync(path.join(stateDir, "agent-runtime.json"), "utf8"));
    token = fs.readFileSync(path.join(stateDir, "agent-hook-token"), "utf8").trim();
  } catch { return; }
  if (!Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 || !/^[a-f0-9]{64}$/.test(token)) return;
  try {
    await fetch(`http://127.0.0.1:${runtime.port}/api/agents/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // MAX may be closed. Hook delivery must never stall or break the agent.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch(() => {});
}
