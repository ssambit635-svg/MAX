import { Pet } from "./Pet";
import { clockTime, durationLabel, timeAgo } from "../lib/format";
import type { Mood, StatePayload } from "../lib/types";

interface NowViewProps {
  state: StatePayload;
  mood: Mood;
  caption: string;
  gaze: { x: number; y: number };
  focusUntil: number | null;
  noteOpen: boolean;
  noteText: string;
  busy: boolean;
  onNoteText: (value: string) => void;
  onSaveNote: () => void;
  onCloseNote: () => void;
  onRun: (command: string) => void;
  onPoke: () => void;
  onOpenNote: () => void;
}

/** Show the folder the way a person reads it: `~/Documents/MAX notes`. */
function prettyFolder(folder: string) {
  if (!folder) return "your Documents folder";
  const cleaned = folder.replace(/\\/g, "/");
  const match = cleaned.match(/^([A-Za-z]:)?\/Users\/[^/]+\/(.*)$/);
  if (match) return `~/${match[2]}`;
  const linuxHome = cleaned.match(/^\/home\/[^/]+\/(.*)$/);
  if (linuxHome) return `~/${linuxHome[1]}`;
  const tail = cleaned.split("/").filter(Boolean).slice(-2).join("/");
  return tail || "your Documents folder";
}

export function NowView({
  state,
  mood,
  caption,
  gaze,
  focusUntil,
  noteOpen,
  noteText,
  busy,
  onNoteText,
  onSaveNote,
  onCloseNote,
  onRun,
  onPoke,
  onOpenNote,
}: NowViewProps) {
  const { vscode, github, render } = state.stats;
  const { notes, activity, config: settings } = state;

  const focusMinutesLeft = focusUntil ? Math.max(0, Math.round((focusUntil - Date.now()) / 60000)) : 0;
  const focusPct = focusUntil ? Math.min(100, Math.round((focusMinutesLeft / 25) * 100)) : 0;
  const workspace = vscode.recent[0]?.name || vscode.workspace || "no workspace";
  const deploysLive = render.demo ? null : `${render.live}/${render.total} live`;

  return (
    <div className="view now">
      <div className="pet-stage">
        <Pet mood={mood} size={168} gaze={gaze} onPoke={onPoke} />
        <div className="mood-label">{mood === "working" ? "in focus" : mood}</div>
        <div className="mood-caption">{caption || "I'm here. Ask me for anything small."}</div>
      </div>

      <div className="grid" style={{ alignContent: "start" }}>
        <div className="card">
          <div className="card__head">
            <span className="card__title">Right now</span>
            {focusUntil ? (
              <span className="card__badge" data-tone="live">
                {durationLabel(focusMinutesLeft)} left
              </span>
            ) : (
              <span className="card__badge">{settings.prefs.keepIslandOpen ? "pinned" : "ambient"}</span>
            )}
          </div>

          <div className="meta-line" style={{ marginBottom: 6 }}>
            <span className="dot" data-tone={vscode.running ? "live" : "warn"} />
            <span>
              {vscode.running ? "VS Code is open" : "VS Code is closed"} · {workspace}
            </span>
          </div>
          <div className="meta-line" style={{ marginBottom: 12 }}>
            <span className="dot" data-tone={render.services.some((s) => s.deploy === "live") ? "live" : "warn"} />
            <span>
              {deploysLive ? `${deploysLive} on Render` : `${render.total} services tracked`} · {github.commitsToday} commits today
            </span>
          </div>

          <div className="chips">
            <button className="chip" onClick={() => onRun("open vs code")}>
              Open VS Code
            </button>
            <button className="chip" onClick={() => onRun("open chrome")}>
              Open Chrome
            </button>
            <button className="chip" onClick={onOpenNote}>
              Save a note
            </button>
            <button className="chip" onClick={() => onRun("focus 25")}>
              {focusUntil ? "Restart focus" : "Focus 25m"}
            </button>
          </div>

          {focusUntil && (
            <div style={{ marginTop: 12 }}>
              <div className="bar__head">
                <span>Focus block</span>
                <span>{focusPct}%</span>
              </div>
              <div className="bar__track">
                <div className="bar__fill" style={{ width: `${focusPct}%` }} />
              </div>
            </div>
          )}

          {noteOpen && (
            <div className="composer-note" style={{ marginTop: 12 }}>
              <textarea
                autoFocus
                value={noteText}
                placeholder="Write the note. Markdown is fine — I'll save it as a .md file."
                onChange={(event) => onNoteText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    onSaveNote();
                  }
                  if (event.key === "Escape") onCloseNote();
                }}
              />
              <div className="composer-note__foot">
                <button className="btn" data-variant="primary" disabled={busy || !noteText.trim()} onClick={onSaveNote}>
                  {busy ? "Saving…" : "Save note"}
                </button>
                <button className="btn" data-variant="quiet" onClick={onCloseNote}>
                  Cancel
                </button>
                <span className="hint" style={{ marginLeft: "auto" }}>
                  <span className="kbd">⌘</span> + <span className="kbd">↵</span>
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card__head">
            <span className="card__title">Live activity</span>
            <span className="card__badge">{activity.length}</span>
          </div>
          <div className="list">
            {activity.length === 0 && <div className="empty">Nothing yet. Try “open chrome” or “save note …” below.</div>}
            {activity.slice(0, 6).map((entry) => (
              <div key={entry.id} className="list__item">
                <span className="list__icon" data-kind={entry.kind}>
                  {entry.kind === "note" ? "✎" : entry.kind === "error" ? "!" : "›"}
                </span>
                <span className="list__text" title={entry.detail ?? entry.title}>
                  {entry.title}
                </span>
                <span className="list__time">{clockTime(entry.at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <span className="card__title">Recent saves</span>
            <span className="card__badge">{state.notes.length}</span>
          </div>
          <div className="list">
            {notes.length === 0 && (
              <div className="empty">
                Saved notes land in{" "}
                <span style={{ color: "var(--text-2)" }}>{prettyFolder(state.config.saveDir)}</span>.
              </div>
            )}
            {notes.slice(0, 4).map((note) => (
              <div key={note.path} className="list__item">
                <span className="list__icon" data-kind="note">
                  ✎
                </span>
                <span className="list__text" title={`Saved ${timeAgo(note.modified)}`}>
                  {note.name}
                </span>
                <span className="list__time">{timeAgo(note.modified)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
