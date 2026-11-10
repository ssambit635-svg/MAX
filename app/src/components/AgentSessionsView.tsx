import { useState } from "react";
import { api } from "../lib/api";
import type { AgentProviderStatus, AgentSession } from "../lib/types";

const PROVIDER_LABEL: Record<AgentSession["provider"], string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  cursor: "Cursor Agent",
  "gemini-cli": "Gemini CLI",
};
const STATUS_LABEL: Record<AgentSession["status"], string> = {
  working: "Working", waiting: "Waiting for you", finished: "Finished", error: "Needs attention",
};
const STATUS_DOT_CLASS: Record<AgentSession["status"], string> = {
  working: "agent-session__dot--working", waiting: "agent-session__dot--waiting",
  finished: "agent-session__dot--finished", error: "agent-session__dot--error",
};
const STATUS_TEXT_CLASS: Partial<Record<AgentSession["status"], string>> = {
  waiting: "agent-session__status--waiting", error: "agent-session__status--error",
};

function relativeTime(at: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

type HookPlan = { provider: string; action: "install" | "uninstall"; fingerprint: string; diff: string; settingsPath: string };
type ReplyPlan = { confirmationId: string; provider: AgentSession["provider"]; sessionId: string; project: string; title: string; text: string; mode: "resume-cli" | "copy-only"; intent: "follow-up" | "question-reply"; message: string };

export function AgentSessionsView({
  sessions, providers, onProviders, onSessions, onNotice,
}: {
  sessions: AgentSession[];
  providers: AgentProviderStatus[];
  onProviders: (providers: AgentProviderStatus[]) => void;
  onSessions: (sessions: AgentSession[]) => void;
  onNotice: (text: string, tone: "ok" | "error") => void;
}) {
  const [plan, setPlan] = useState<HookPlan | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [replyPlan, setReplyPlan] = useState<ReplyPlan | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  async function preview(provider: AgentProviderStatus, action: "install" | "uninstall") {
    setBusyProvider(provider.provider);
    setError("");
    try {
      setPlan(await api.previewAgentHooks(provider.provider, action));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MAX couldn't preview the agent settings.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusyProvider(plan.provider);
    setError("");
    try {
      const result = await api.applyAgentHooks(plan.provider, plan.action, plan.fingerprint);
      onProviders(result.providers);
      const outcome = result.action === "uninstall" ? "MAX hooks removed from that agent." : "MAX hooks installed. Restart that agent to activate them.";
      onNotice(result.backup ? `${outcome} Backup: ${result.backup}` : outcome, "ok");
      setPlan(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MAX couldn't safely update those settings.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function clearSessions() {
    try {
      await api.clearAgentSessions();
      onSessions([]);
      onNotice("Agent session snippets cleared from MAX's memory.", "ok");
    } catch {
      onNotice("MAX couldn't clear the session list.", "error");
    }
  }

  async function previewReply(session: AgentSession, intent: "question-reply" | "follow-up") {
    const draftKey = `${session.provider}:${session.sessionId}`;
    const text = replyDrafts[draftKey] ?? "";
    setError("");
    setBusyProvider(session.provider);
    try {
      const preview = await api.previewAgentReply(session.provider, session.sessionId, intent === "question-reply" ? (session.pending?.requestId ?? "") : "", text);
      setReplyPlan(preview);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MAX couldn't safely prepare that message.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function confirmReply() {
    if (!replyPlan) return;
    setBusyProvider(replyPlan.provider);
    setError("");
    try {
      const result = await api.confirmAgentReply(replyPlan.confirmationId);
      if (result.mode === "copy-only") {
        await navigator.clipboard.writeText(replyPlan.text);
        onNotice("Copied. Paste it into the agent yourself; MAX did not send it.", "ok");
      } else {
        onNotice(result.message, "ok");
      }
      setReplyDrafts((drafts) => ({ ...drafts, [`${replyPlan.provider}:${replyPlan.sessionId}`]: "" }));
      setReplyPlan(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MAX couldn't complete that reply.");
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <section className="agents-view" aria-label="Coding agent sessions">
      <header className="agents-view__header">
        <div>
          <div className="eyebrow">LOCAL · USER-CONTROLLED</div>
          <h2>Agent sessions</h2>
          <p>MAX reads selected lifecycle events locally. It does not upload transcripts.</p>
        </div>
        <div className="agents-view__tools">
          <span className="agents-view__count">{sessions.length} recent</span>
          {sessions.length > 0 && <button className="btn" data-variant="quiet" onClick={() => void clearSessions()}>Clear memory</button>}
        </div>
      </header>

      <div className="agent-providers" aria-label="Supported coding agents">
        {providers.map((provider) => (
          <article className="agent-provider" key={provider.provider}>
            <div>
              <strong>{PROVIDER_LABEL[provider.provider]}</strong>
              <span className={provider.installed ? "agent-provider__connected" : "agent-provider__off"}>
                {provider.installed ? "MAX hooks installed" : "Not connected"}
              </span>
            </div>
            <button
              className="btn"
              data-variant={provider.installed ? "quiet" : "primary"}
              disabled={(!provider.canInstall && !provider.installed) || busyProvider !== null}
              onClick={() => void preview(provider, provider.installed ? "uninstall" : "install")}
              title={provider.canInstall || provider.installed ? `Review changes to ${provider.settingsPath}` : "Install Node.js to enable local lifecycle hooks"}
            >
              {busyProvider === provider.provider ? "Preparing…" : provider.installed ? "Review removal" : "Review setup"}
            </button>
          </article>
        ))}
      </div>

      <p className="agents-privacy-note">Hook setup is optional. MAX previews changes and backs up the existing settings file before applying them. No settings change until you confirm.</p>
      {error && <p className="agents-error" role="alert">{error}</p>}

      {plan && (
        <div className="agent-hook-review" role="dialog" aria-modal="true" aria-label="Review agent hook changes">
          <header>
            <div>
              <strong>{plan.action === "install" ? "Review hook setup" : "Review hook removal"}</strong>
              <span>{plan.settingsPath}</span>
            </div>
            <button className="btn" data-variant="quiet" onClick={() => setPlan(null)} disabled={busyProvider !== null}>Cancel</button>
          </header>
          <p>Secrets are redacted in this preview. Existing unrelated settings are preserved. MAX makes a backup before writing.</p>
          <pre>{plan.diff}</pre>
          {error && <p className="agents-error" role="alert">{error}</p>}
          <button className="btn" data-variant="primary" onClick={() => void apply()} disabled={busyProvider !== null}>
            {busyProvider ? "Applying…" : plan.action === "install" ? "Back up & install hooks" : "Back up & remove MAX hooks"}
          </button>
        </div>
      )}

      {replyPlan && (
        <div className="agent-hook-review" role="dialog" aria-modal="true" aria-label="Confirm agent reply">
          <header>
            <div>
              <strong>{replyPlan.intent === "question-reply" ? "Confirm reply" : "Confirm next instruction"}</strong>
              <span>{PROVIDER_LABEL[replyPlan.provider]} · {replyPlan.project} · session {replyPlan.sessionId}</span>
            </div>
            <button className="btn" data-variant="quiet" onClick={() => setReplyPlan(null)} disabled={busyProvider !== null}>Cancel</button>
          </header>
          <p>{replyPlan.message}</p>
          {replyPlan.mode === "resume-cli" && <p className="agents-warning">Resuming can cause the coding agent to use its own configured tools and permissions. MAX does not approve tool permissions.</p>}
          <pre>{replyPlan.text}</pre>
          {error && <p className="agents-error" role="alert">{error}</p>}
          <button className="btn" data-variant="primary" onClick={() => void confirmReply()} disabled={busyProvider !== null}>
            {busyProvider ? "Working…" : replyPlan.mode === "resume-cli" ? "Send to this session" : "Confirm & copy reply"}
          </button>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="agents-empty">
          <div className="agents-empty__icon" aria-hidden="true">⌘</div>
          <h3>No agent events yet</h3>
          <p>Review setup for an agent above, then restart it. MAX will show its lifecycle events here.</p>
          <p className="agents-empty__note">MAX never approves tool permissions. Replies or next instructions require a separate review and confirmation; without a direct supported CLI, MAX only copies the text.</p>
        </div>
      ) : (
        <div className="agents-list">
          {sessions.map((session) => (
            <article className="agent-session" key={`${session.provider}:${session.sessionId}`}>
              <div className="agent-session__top">
                <div className="agent-session__identity">
                  <span className={`agent-session__dot ${STATUS_DOT_CLASS[session.status]}`} />
                  <strong>{PROVIDER_LABEL[session.provider]}</strong>
                  <span className="agent-session__project">{session.project}</span>
                </div>
                <span className={`agent-session__status ${STATUS_TEXT_CLASS[session.status] ?? ""}`}>{STATUS_LABEL[session.status]}</span>
              </div>
              <div className="agent-session__title">{session.title}</div>
              {session.pending && (
                <div className="agent-session__question">
                  <span>{session.pending.type === "permission-request" ? "Permission request" : "Question"}</span>
                  <p>{session.pending.text}</p>
                  {session.pending.type === "question" && (
                    <div className="agent-reply-composer">
                      <textarea
                        value={replyDrafts[`${session.provider}:${session.sessionId}`] ?? ""}
                        maxLength={3000}
                        rows={2}
                        placeholder="Write your answer…"
                        onChange={(event) => setReplyDrafts((drafts) => ({ ...drafts, [`${session.provider}:${session.sessionId}`]: event.target.value }))}
                      />
                      <button className="btn" data-variant="primary" disabled={busyProvider !== null || !(replyDrafts[`${session.provider}:${session.sessionId}`] ?? "").trim()} onClick={() => void previewReply(session, "question-reply")}>
                        {providers.find((entry) => entry.provider === session.provider)?.canReply ? "Review & send reply" : "Review & copy reply"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {session.status === "finished" && !session.pending && (
                <div className="agent-reply-composer agent-reply-composer--followup">
                  <textarea
                    value={replyDrafts[`${session.provider}:${session.sessionId}`] ?? ""}
                    maxLength={3000}
                    rows={2}
                    placeholder="Send the next instruction…"
                    onChange={(event) => setReplyDrafts((drafts) => ({ ...drafts, [`${session.provider}:${session.sessionId}`]: event.target.value }))}
                  />
                  <button className="btn" data-variant="quiet" disabled={busyProvider !== null || !(replyDrafts[`${session.provider}:${session.sessionId}`] ?? "").trim()} onClick={() => void previewReply(session, "follow-up")}>
                    {providers.find((entry) => entry.provider === session.provider)?.canReply ? "Review next instruction" : "Review & copy next instruction"}
                  </button>
                </div>
              )}
              <footer className="agent-session__footer">Updated {relativeTime(session.updatedAt)}</footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
