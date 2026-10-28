import { compactNumber, timeAgo } from "../lib/format";
import type { IntegrationId, Stats } from "../lib/types";

interface StatsViewProps {
  stats: Stats;
  highlight: IntegrationId | null;
  onConnect: () => void;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="spark" aria-hidden>
      {values.map((value, index) => (
        <div
          key={index}
          className="spark__bar"
          style={{
            height: `${Math.max(8, Math.round((value / max) * 100))}%`,
            animationDelay: `${index * 55}ms`,
            opacity: value === 0 ? 0.35 : 1,
          }}
        />
      ))}
    </div>
  );
}

export function StatsView({ stats, highlight, onConnect }: StatsViewProps) {
  const { github, leetcode, render, vscode, system } = stats;
  const solvedPct = leetcode.totals.all ? Math.round((leetcode.solved.all / leetcode.totals.all) * 100) : 0;
  const circumference = 2 * Math.PI * 34;
  const dash = (solvedPct / 100) * circumference;
  const maxHeat = Math.max(1, ...leetcode.heatmap);

  const badge = (demo: boolean, liveLabel = "live") =>
    demo ? (
      <span className="card__badge" data-tone="warn">
        demo
      </span>
    ) : (
      <span className="card__badge" data-tone="live">
        {liveLabel}
      </span>
    );

  return (
    <div className="view stats">
      <div className="card" data-highlight={highlight === "github"}>
        <div className="card__head">
          <span className="card__title">GitHub</span>
          {badge(github.demo)}
        </div>
        <div className="meta-line" style={{ marginBottom: 12 }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(140deg, rgba(143,168,255,.9), rgba(111,231,255,.7))",
              color: "#06121a",
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            {(github.login || "?").slice(0, 1).toUpperCase()}
          </span>
          <span style={{ color: "var(--text)", fontWeight: 550 }}>{github.name || github.login}</span>
          <span style={{ color: "var(--muted)" }}>@{github.login}</span>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat__value">{github.commitsToday}</span>
            <span className="stat__label">today</span>
          </div>
          <div className="stat">
            <span className="stat__value">{github.commitsWeek}</span>
            <span className="stat__label">this week</span>
          </div>
          <div className="stat">
            <span className="stat__value">{github.openPrs}</span>
            <span className="stat__label">open PRs</span>
          </div>
        </div>
        <Sparkline values={github.sparkline.length ? github.sparkline : [0, 0, 0, 0, 0, 0, 0]} />
        <div className="lang">
          {github.languages.slice(0, 3).map((language) => (
            <div className="lang__row" key={language.name}>
              <span style={{ width: 62, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {language.name}
              </span>
              <span className="lang__track">
                <span className="lang__fill" style={{ width: `${language.pct}%` }} />
              </span>
              <span className="lang__pct">{language.pct}%</span>
            </div>
          ))}
        </div>
        {github.demo && (
          <button className="hint" style={{ marginTop: 10, textAlign: "left", padding: 0 }} onClick={onConnect}>
            Demo data — connect GitHub in Settings →
          </button>
        )}
        {github.note && <div className="hint" style={{ marginTop: 8 }}>{github.note}</div>}
      </div>

      <div className="card" data-highlight={highlight === "leetcode"}>
        <div className="card__head">
          <span className="card__title">LeetCode</span>
          {badge(leetcode.demo)}
        </div>
        <div className="ring-row">
          <div className="ring">
            <svg width="82" height="82" viewBox="0 0 82 82">
              <circle className="ring__track" cx="41" cy="41" r="34" fill="none" strokeWidth="7" />
              <circle
                className="ring__value"
                cx="41"
                cy="41"
                r="34"
                fill="none"
                stroke="url(#ringGrad)"
                strokeWidth="7"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset="0"
              />
            </svg>
            <div className="ring__center">
              <span className="ring__number">{leetcode.solved.all}</span>
              <span className="ring__sub">solved</span>
            </div>
          </div>
          <div className="diff">
            {(["easy", "medium", "hard"] as const).map((difficulty) => (
              <div className="diff__row" key={difficulty}>
                <span className="diff__label" style={{ textTransform: "capitalize" }}>
                  {difficulty}
                </span>
                <span className="diff__track">
                  <span
                    className="diff__fill"
                    data-diff={difficulty}
                    style={{
                      width: `${leetcode.totals[difficulty] ? Math.min(100, (leetcode.solved[difficulty] / leetcode.totals[difficulty]) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="diff__count">{leetcode.solved[difficulty]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="meta-line" style={{ marginTop: 12 }}>
          <span className="dot" data-tone={leetcode.streak > 0 ? "live" : "warn"} />
          <span>
            {leetcode.streak} day streak · {leetcode.todaySolved} solved today · rank {compactNumber(leetcode.ranking)}
          </span>
        </div>
        <div className="heat" aria-hidden>
          {leetcode.heatmap.slice(-28).map((value, index) => (
            <span
              key={index}
              className="heat__cell"
              data-level={value === 0 ? 0 : Math.min(4, Math.ceil((value / maxHeat) * 4))}
              title={`${value} submissions`}
            />
          ))}
        </div>
        {leetcode.demo && (
          <button className="hint" style={{ marginTop: 10, textAlign: "left", padding: 0 }} onClick={onConnect}>
            Demo data — add your LeetCode handle in Settings →
          </button>
        )}
        {leetcode.note && <div className="hint" style={{ marginTop: 8 }}>{leetcode.note}</div>}
      </div>

      <div className="card span-2" data-highlight={highlight === "render"}>
        <div className="card__head">
          <span className="card__title">Render</span>
          {badge(render.demo)}
          <span className="card__badge">
            {render.live}/{render.total} live
          </span>
        </div>
        {render.services.map((service) => (
          <div className="svc" key={service.name}>
            <span
              className="dot"
              data-tone={
                service.deploy === "live" || service.deploy === "deployed"
                  ? "live"
                  : service.deploy === "build_failed" || service.deploy === "failed" || service.deploy === "canceled"
                    ? "error"
                    : "warn"
              }
            />
            <span className="svc__name">{service.name}</span>
            <span className="svc__meta">
              {service.type.replace(/_/g, " ")} · {service.deploy} · {timeAgo(service.updatedAt)}
            </span>
          </div>
        ))}
        {render.demo && (
          <button className="hint" style={{ marginTop: 10, textAlign: "left", padding: 0 }} onClick={onConnect}>
            Demo data — paste a Render API key in Settings →
          </button>
        )}
        {render.note && <div className="hint" style={{ marginTop: 8 }}>{render.note}</div>}
      </div>

      <div className="card" data-highlight={highlight === "vscode"}>
        <div className="card__head">
          <span className="card__title">VS Code</span>
          <span className="card__badge" data-tone={vscode.running ? "live" : undefined}>
            {vscode.running ? "running" : "closed"}
          </span>
        </div>
        <div className="meta-line" style={{ marginBottom: 8 }}>
          <span className="dot" data-tone={vscode.running ? "live" : "warn"} />
          <span>{vscode.workspace || "no workspace yet"}</span>
        </div>
        <div className="list">
          {vscode.recent.slice(0, 3).map((workspace) => (
            <div className="list__item" key={workspace.path}>
              <span className="list__icon">⌘</span>
              <span className="list__text" title={workspace.path}>
                {workspace.name}
              </span>
              <span className="list__time">{timeAgo(workspace.modified)}</span>
            </div>
          ))}
          {vscode.recent.length === 0 && <div className="empty">Open a folder in VS Code and I'll track it.</div>}
        </div>
      </div>

      <div className="card" data-highlight={highlight === "system"}>
        <div className="card__head">
          <span className="card__title">This machine</span>
          <span className="card__badge">{system.platform}</span>
        </div>
        <div className="bars">
          <div>
            <div className="bar__head">
              <span>CPU</span>
              <span>{system.cpu}%</span>
            </div>
            <div className="bar__track">
              <div className="bar__fill" style={{ width: `${system.cpu}%` }} />
            </div>
          </div>
          <div>
            <div className="bar__head">
              <span>Memory</span>
              <span>
                {system.memUsed}% of {system.memTotalGb} GB
              </span>
            </div>
            <div className="bar__track">
              <div className="bar__fill" style={{ width: `${system.memUsed}%` }} />
            </div>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          {system.hostname} · up {system.uptimeHours}h
        </div>
      </div>
    </div>
  );
}
