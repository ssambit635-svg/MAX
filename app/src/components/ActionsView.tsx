import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { AppEntry } from "../lib/types";

interface ActionsViewProps {
  apps: AppEntry[];
  onRun: (command: string) => void;
  onNotice?: (text: string, tone: "ok" | "error") => void;
}

/** Paste-in command that dumps every app on the laptop to a text file. */
const SCAN_COMMAND =
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Get-StartApps | Sort-Object Name | ForEach-Object { $_.Name } | Out-File \\\"$env:USERPROFILE\\Desktop\\max-apps.txt\\\" -Encoding utf8; Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object DisplayName | ForEach-Object { $_.DisplayName } | Sort-Object -Unique | Out-File \\\"$env:USERPROFILE\\Desktop\\max-apps.txt\\\" -Append -Encoding utf8; notepad \\\"$env:USERPROFILE\\Desktop\\max-apps.txt\\\"\"";

/** Friendly words only — no paths, no registry, no process names. */
const HOW_LABEL: Record<string, string> = {
  exe: "Installed app",
  appx: "Microsoft Store app",
  protocol: "Windows app",
  "default-browser": "Your default browser",
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

export function ActionsView({ apps, onRun, onNotice }: ActionsViewProps) {
  const [scanned, setScanned] = useState<AppEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [showScan, setShowScan] = useState(false);

  const scan = useCallback(async () => {
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
  }, []);

  // Resolve the allowlist against this machine once, so the list never offers a
  // program that is not installed.
  useEffect(() => {
    void scan();
  }, [scan]);

  const { installed, missing } = useMemo(() => {
    if (!scanned) return { installed: apps, missing: [] as AppEntry[] };
    return {
      installed: scanned.filter((app) => app.available !== false),
      missing: scanned.filter((app) => app.available === false),
    };
  }, [scanned, apps]);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(SCAN_COMMAND);
      onNotice?.("Command copied — paste it in PowerShell.", "ok");
    } catch {
      onNotice?.("Select the command and copy it manually.", "error");
    }
  };

  return (
    <div className="view">
      <div className="section">
        <div className="section__head">
          <h3 className="section__title">
            Apps on this laptop · {installed.length}
            {scanning ? " · checking…" : ""}
          </h3>
          <button className="text-link" onClick={() => void scan()} disabled={scanning}>
            check again
          </button>
        </div>

        {installed.length === 0 ? (
          <div className="hint">
            {scanning ? "Looking for your apps…" : "Nothing I know yet. Install an app, then press “check again”."}
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {installed.map((app) => (
              <button
                key={app.id}
                className="action"
                title={`${HOW_LABEL[app.how ?? ""] ?? "Installed app"} — open ${app.label}`}
                onClick={() => onRun(`open ${app.terms[0]}`)}
              >
                <span className="action__cmd">{app.label}</span>
                <span className="action__desc">open</span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="hint">{error}</div>}

        {missing.length > 0 && (
          <div className="hint">
            <button className="text-link" onClick={() => setShowMissing((value) => !value)}>
              {showMissing ? "hide" : "show"} {missing.length} app{missing.length === 1 ? "" : "s"} not found here
            </button>
            {showMissing && <div className="hint__body">{missing.map((app) => app.label).join(", ")}</div>}
          </div>
        )}

        <div className="hint">
          <button className="text-link" onClick={() => setShowScan((value) => !value)}>
            {showScan ? "hide" : "my app isn’t listed"} →
          </button>
          {showScan && (
            <div className="hint__body">
              Paste this into PowerShell. It only reads, changes nothing, and opens a list of your installed apps in
              Notepad — keep that list next to MAX and it will remember every app you have.
              <pre className="code-block">{SCAN_COMMAND}</pre>
              <button className="btn" data-variant="quiet" onClick={() => void copyCommand()}>
                Copy
              </button>
            </div>
          )}
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
