import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { AppEntry } from "../lib/types";

interface ActionsViewProps {
  apps: AppEntry[];
  onRun: (command: string) => void;
}

const SCAN_NOTE = "Checked this machine — only the apps found here are listed.";

const HOW_LABEL: Record<string, string> = {
  exe: "its executable",
  appx: "the Start menu (Microsoft Store app)",
  protocol: "its system link",
  "default-browser": "your default browser",
};

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
  const [scanned, setScanned] = useState<AppEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await api.apps();
      setScanned(result.apps);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  // Resolve the allowlist against this machine once, so the list never offers a
  // program that is not installed.
  useEffect(() => {
    void scan();
  }, []);

  const { list, hidden } = useMemo(() => {
    const source = scanned ?? apps;
    const found = source.filter((app) => app.available !== false);
    const missing = scanned ? scanned.filter((app) => app.available === false) : [];
    return { list: found.length ? found : source, hidden: missing };
  }, [scanned, apps]);

  return (
    <div className="view">
      <div className="section">
        <div className="section__head">
          <h3 className="section__title">Apps · click to launch</h3>
          <button className="text-link" onClick={() => void scan()} disabled={scanning}>
            {scanning ? "scanning…" : "scan again"}
          </button>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {list.map((app) => (
            <button
              key={app.id}
              className="action"
              title={app.how ? `Found via ${HOW_LABEL[app.how] ?? app.how}` : `Open ${app.label}`}
              onClick={() => onRun(`open ${app.terms[0]}`)}
            >
              <span className="action__cmd">{app.label}</span>
              <span className="action__desc">open</span>
            </button>
          ))}
        </div>
        {error ? <div className="hint">{error}</div> : scanned ? <div className="hint">{SCAN_NOTE}</div> : null}
        {hidden.length > 0 && (
          <div className="hint">
            Not installed here: {hidden.map((app) => app.label).join(", ")}. Install one and press “scan again”.
          </div>
        )}
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
