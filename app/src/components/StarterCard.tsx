import type { Mood, StatePayload } from "../lib/types";
import { Pet } from "./Pet";

interface StarterProps {
  state: StatePayload;
  busy: boolean;
  onRun: (command: string) => void;
  onNote: () => void;
  onDismiss: () => void;
}

/**
 * The first-run guide. Three one-tap demos so a brand-new user can prove the app works
 * without having to learn the command grammar first. It retires itself after the first
 * successful action (the activity log is no longer empty) or when dismissed.
 */
export function StarterCard({ state, busy, onRun, onNote, onDismiss }: StarterProps) {
  const steps = [
    {
      key: "open",
      title: "Open an app",
      detail: "Runs an allowlisted launch — no shell, no guessing.",
      action: () => onRun("open notepad"),
      cta: "Open Notepad",
    },
    {
      key: "note",
      title: "Save a note",
      detail: "Writes a real .md file you can open in Explorer.",
      action: onNote,
      cta: "Write a note",
    },
    {
      key: "stats",
      title: "See your numbers",
      detail: "GitHub, LeetCode, Render, VS Code, this PC.",
      action: () => onRun("stats"),
      cta: "Show stats",
    },
  ];

  return (
    <div className="starter">
      <div className="starter__head">
        <span className="starter__badge">First run</span>
        <span className="starter__title">Start here — try one</span>
        <button className="starter__close" onClick={onDismiss} aria-label="Hide guide">
          ✕
        </button>
      </div>

      <div className="starter__grid">
        {steps.map((step, index) => (
          <button key={step.key} className="starter__step" disabled={busy} onClick={step.action}>
            <span className="starter__num">{index + 1}</span>
            <span className="starter__text">
              <span className="starter__step-title">{step.title}</span>
              <span className="starter__step-detail">{step.detail}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="starter__foot">
        Or type anything below — try <code>open chrome</code>, <code>save note …</code> or <code>help</code>.
        <span className="starter__spot">{state.apps.length} apps ready</span>
      </div>
    </div>
  );
}

interface CoachProps {
  mood: Mood;
  onDismiss: () => void;
}

/** The one-time arrow that explains the pill, shown while MAX has never run a command. */
export function PillCoach({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button className="pill-coach" onClick={onDismiss} aria-label="Got it">
      <span className="pill-coach__hand">👆</span>
      <span className="pill-coach__text">
        Click this bar to open MAX
        <span className="pill-coach__hint">or press Ctrl + Shift + Space anywhere</span>
      </span>
      <span className="pill-coach__ok">Got it</span>
    </button>
  );
}

export function PetGreeting({ mood }: CoachProps) {
  return <Pet mood={mood} size={40} compact />;
}
