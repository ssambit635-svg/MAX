import type { AppEntry } from "../lib/types";

interface ActionsViewProps {
  apps: AppEntry[];
  onRun: (command: string) => void;
}

const GROUPS: { title: string; items: { cmd: string; desc: string }[] }[] = [
  {
    title: "Web",
    items: [
      { cmd: "open github", desc: "Dashboard" },
      { cmd: "open render", desc: "Deploys" },
      { cmd: "open leetcode", desc: "Practice" },
      { cmd: "search youtube for lofi", desc: "Focus music" },
    ],
  },
  {
    title: "Notes & focus",
    items: [
      { cmd: "new note", desc: "Composer" },
      { cmd: "save note remember to push my branch", desc: "Instant .md file" },
      { cmd: "focus 25", desc: "Pomodoro" },
      { cmd: "timer 10", desc: "Short reminder" },
    ],
  },
  {
    title: "Insight",
    items: [
      { cmd: "stats github", desc: "Commits, PRs, streak" },
      { cmd: "stats leetcode", desc: "Solved, difficulty mix" },
      { cmd: "stats render", desc: "Service health" },
      { cmd: "stats vscode", desc: "Recent workspaces" },
    ],
  },
];

export function ActionsView({ apps, onRun }: ActionsViewProps) {
  return (
    <div className="view">
      <div className="section">
        <h3 className="section__title">Apps · click to launch</h3>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {apps.slice(0, 8).map((app) => (
            <button key={app.id} className="action" onClick={() => onRun(`open ${app.terms[0]}`)}>
              <span className="action__cmd">{app.label}</span>
              <span className="action__desc">open</span>
            </button>
          ))}
        </div>
      </div>

      {GROUPS.map((group) => (
        <div className="section" key={group.title}>
          <h3 className="section__title">{group.title}</h3>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {group.items.map((item) => (
              <button key={item.cmd} className="action" onClick={() => onRun(item.cmd)}>
                <span className="action__cmd">{item.cmd}</span>
                <span className="action__desc">{item.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="hint">
        No voice, no AI, no cloud. MAX runs a hand-written command table against an explicit app allowlist, so it
        can never run an arbitrary shell command.
      </div>
    </div>
  );
}
