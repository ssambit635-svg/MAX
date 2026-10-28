import { compactNumber, timeAgo } from "../lib/format";
import { ContributionGraph } from "./ContributionGraph";
import type { IntegrationId, Stats } from "../lib/types";

interface StatsViewProps {
  stats: Stats;
  highlight: IntegrationId | null;
  onConnect: () => void;
}

function Badge({ demo, text }: { demo: boolean; text: string }) {
  return (
    <span className="badge" data-tone={demo ? "demo" : "live"}>
      {demo ? "demo" : text}
    </span>
  );
}

function Metric({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="metric">
      <span className="metric__value">
        {value}
        {sub && <small>{sub}</small>}
      </span>
      <span className="metric__label">{label}</span>
    </div>
  );
}

export function StatsView({ stats, highlight, onConnect }: StatsViewProps) {
  const { github, leetcode, render, vscode, system } = stats;
  const solvedPct = leetcode.totals.all ? Math.round((leetcode.solved.all / leetcode.totals.all) * 100) : 0;
  const circumference = 2 * Math.PI * 30;
  const dash = (solvedPct / 100) * circumference;
  const maxHeat = Math.max(1, ...leetcode.heatmap);

  return (
    <div className="view dash">
      {/* ------------------------------------------------------------- github */}
      <section className="panel-card span-2" data-highlight={highlight === "github"}>
        <header className="panel-card__head">
          <h3>GitHub</h3>
          <Badge demo={github.demo} text="live" />
          <span className="panel-card__who">@{github.login}</span>
        </header>

        <div className="metrics">
          <Metric value={String(github.contributions?.total ?? github.commitsWeek)} label="contributions" sub=" / year" />
          <Metric value={String(github.repos)} label="repositories" />
          <Metric value={String(github.stars)} label="stars" />
          <Metric value={String(github.streak)} label="day streak" />
        </div>

        {github.contributions ? (
          <ContributionGraph data={github.contributions} />
        ) : (
          <div className="panel-empty">Contribution calendar is not reachable right now.</div>
        )}

        <footer className="panel-card__foot">
          <div className="langs">
            {github.languages.slice(0, 4).map((language) => (
              <div className="lang" key={language.name}>
                <span className="lang__name">{language.name}</span>
                <span className="lang__track">
                  <span className="lang__fill" style={{ width: `${language.pct}%` }} />
                </span>
                <span className="lang__pct">{language.pct}%</span>
              </div>
            ))}
          </div>
          {github.demo && (
            <button className="text-link" onClick={onConnect}>
              Connect GitHub →
            </button>
          )}
        </footer>

        {github.activity.length > 0 && (
          <ul className="timeline">
            {github.activity.slice(0, 3).map((entry, index) => (
              <li key={index}>
                <span className="timeline__dot" />
                <span className="timeline__text">
                  {entry.title} · <span className="timeline__repo">{entry.repo}</span>
                </span>
                <span className="timeline__time">{timeAgo(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {github.note && <p className="panel-note">{github.note}</p>}
      </section>

      {/* ----------------------------------------------------------- leetcode */}
      <section className="panel-card" data-highlight={highlight === "leetcode"}>
        <header className="panel-card__head">
          <h3>LeetCode</h3>
          <Badge demo={leetcode.demo} text="live" />
          <span className="panel-card__who">{leetcode.username || "—"}</span>
        </header>

        <div className="solve">
          <div className="ring">
            <svg width="72" height="72" viewBox="0 0 72 72">
              <circle className="ring__track" cx="36" cy="36" r="30" fill="none" strokeWidth="6" />
              <circle
                className="ring__value"
                cx="36"
                cy="36"
                r="30"
                fill="none"
                strokeWidth="6"
                strokeDasharray={`${dash} ${circumference - dash}`}
              />
            </svg>
            <div className="ring__center">
              <span className="ring__number">{leetcode.solved.all}</span>
              <span className="ring__sub">solved</span>
            </div>
          </div>
          <div className="solve__rows">
            {(["easy", "medium", "hard"] as const).map((difficulty) => (
              <div className="solve__row" key={difficulty}>
                <span className="solve__label">{difficulty}</span>
                <span className="solve__track">
                  <span
                    className="solve__fill"
                    data-diff={difficulty}
                    style={{
                      width: `${
                        leetcode.totals[difficulty]
                          ? Math.min(100, (leetcode.solved[difficulty] / leetcode.totals[difficulty]) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </span>
                <span className="solve__count">{leetcode.solved[difficulty]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-stats">
          <span>
            <b>{leetcode.streak}</b> day streak
          </span>
          <span>
            <b>{leetcode.todaySolved}</b> today
          </span>
          <span>
            rank <b>{compactNumber(leetcode.ranking)}</b>
          </span>
        </div>

        <div className="heat" aria-hidden>
          {leetcode.heatmap.slice(-28).map((value, index) => (
            <span key={index} className="heat__cell" data-level={value === 0 ? 0 : Math.min(4, Math.ceil((value / maxHeat) * 4))} />
          ))}
        </div>

        {leetcode.demo && (
          <button className="text-link" onClick={onConnect}>
            {leetcode.note ? "Reconnect LeetCode →" : "Connect LeetCode →"}
          </button>
        )}
        {leetcode.note && <p className="panel-note">{leetcode.note}</p>}
      </section>

      {/* ------------------------------------------------------------- render */}
      <section className="panel-card" data-highlight={highlight === "render"}>
        <header className="panel-card__head">
          <h3>Render</h3>
          <Badge demo={render.demo} text={`${render.live}/${render.total} up`} />
        </header>
        <ul className="services">
          {render.services.map((service) => (
            <li key={service.name}>
              <span
                className="status-dot"
                data-tone={
                  service.deploy === "live" || service.deploy === "deployed"
                    ? "live"
                    : ["build_failed", "failed", "canceled"].includes(service.deploy)
                      ? "error"
                      : "warn"
                }
              />
              <span className="services__name">{service.name}</span>
              <span className="services__meta">{timeAgo(service.updatedAt)}</span>
            </li>
          ))}
        </ul>
        {render.demo && (
          <button className="text-link" onClick={onConnect}>
            Connect Render →
          </button>
        )}
      </section>

      {/* ------------------------------------------------------------- vscode */}
      <section className="panel-card" data-highlight={highlight === "vscode"}>
        <header className="panel-card__head">
          <h3>VS Code</h3>
          <Badge demo={false} text={vscode.running ? "running" : "closed"} />
        </header>
        <ul className="services">
          {vscode.recent.slice(0, 3).map((workspace) => (
            <li key={workspace.path}>
              <span className="status-dot" data-tone={vscode.running ? "live" : "warn"} />
              <span className="services__name">{workspace.name}</span>
              <span className="services__meta">{timeAgo(workspace.modified)}</span>
            </li>
          ))}
          {vscode.recent.length === 0 && <li className="panel-empty">Open a folder in VS Code and it appears here.</li>}
        </ul>
      </section>

      {/* ------------------------------------------------------------- system */}
      <section className="panel-card span-2" data-highlight={highlight === "system"}>
        <header className="panel-card__head">
          <h3>This machine</h3>
          <Badge demo={false} text={system.platform} />
          <span className="panel-card__who">{system.hostname}</span>
        </header>
        <div className="gauges">
          <div className="gauge">
            <div className="gauge__head">
              <span>CPU</span>
              <span>{system.cpu}%</span>
            </div>
            <div className="gauge__track">
              <div className="gauge__fill" style={{ width: `${system.cpu}%` }} />
            </div>
          </div>
          <div className="gauge">
            <div className="gauge__head">
              <span>Memory</span>
              <span>
                {system.memUsed}% of {system.memTotalGb} GB
              </span>
            </div>
            <div className="gauge__track">
              <div className="gauge__fill" style={{ width: `${system.memUsed}%` }} />
            </div>
          </div>
          <div className="gauge gauge--flat">
            <span className="metric__label">Uptime</span>
            <span className="metric__value">{system.uptimeHours}h</span>
          </div>
        </div>
      </section>
    </div>
  );
}
