import type { AgentSession } from "../lib/types";

const PROVIDER_LABEL: Record<AgentSession["provider"], string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor Agent",
  "gemini-cli": "Gemini CLI",
};

const STATUS_LABEL: Record<AgentSession["status"], string> = {
  working: "Working",
  waiting: "Waiting for you",
  finished: "Finished",
  error: "Needs attention",
};
const STATUS_DOT_CLASS: Record<AgentSession["status"], string> = {
  working: "agent-session__dot--working",
  waiting: "agent-session__dot--waiting",
  finished: "agent-session__dot--finished",
  error: "agent-session__dot--error",
};
const STATUS_TEXT_CLASS: Partial<Record<AgentSession["status"], string>> = {
  waiting: "agent-session__status--waiting",
  error: "agent-session__status--error",
};

function relativeTime(at: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

export function AgentSessionsView({ sessions }: { sessions: AgentSession[] }) {
  return (
    <section className="agents-view" aria-label="Coding agent sessions">
      <header className="agents-view__header">
        <div>
          <div className="eyebrow">LOCAL · LIVE EVENTS</div>
          <h2>Agent sessions</h2>
          <p>Keep your coding agents in view. MAX does not upload session data.</p>
        </div>
        <span className="agents-view__count">{sessions.length} recent</span>
      </header>

      {sessions.length === 0 ? (
        <div className="agents-empty">
          <div className="agents-empty__icon" aria-hidden="true">⌘</div>
          <h3>Your agents will show up here</h3>
          <p>Connect a supported agent with MAX’s opt-in hook setup to see live session status and questions.</p>
          <p className="agents-empty__note">Hook setup and confirmed replies are being built. Nothing has been changed in your agent settings.</p>
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
                  <button className="btn" data-variant="quiet" disabled title="Provider-specific confirmed replies are not enabled yet">Reply support coming next</button>
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
