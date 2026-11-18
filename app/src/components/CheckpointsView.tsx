import { useEffect, useMemo, useState } from "react";
import { shellBridge, type VoiceDictationEvent } from "../lib/shell";

type Project = { name: string; path: string };
type Checkpoint = { id: string; title: string; next: string; notes: string; projectName: string; projectPath: string; createdAt: number };
const CHECKPOINT_KEY = "max.work-checkpoints.v1";
const PROJECT_KEY = "max.project-launchers.v1";
const MAX_CHECKPOINTS = 30;
const MAX_TEXT = 3000;

function readList<T>(key: string, valid: (item: unknown) => item is T, max: number): T[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, max) : [];
  } catch { return []; }
}

function validProject(value: unknown): value is Project {
  return Boolean(value && typeof value === "object" && typeof (value as Project).name === "string" && typeof (value as Project).path === "string" && (value as Project).name.length <= 80 && (value as Project).path.length <= 2048);
}
function validCheckpoint(value: unknown): value is Checkpoint {
  if (!value || typeof value !== "object") return false;
  const item = value as Checkpoint;
  return typeof item.id === "string" && item.id.length <= 80 && typeof item.title === "string" && item.title.length <= 160 && typeof item.next === "string" && item.next.length <= 300 && typeof item.notes === "string" && item.notes.length <= MAX_TEXT && typeof item.projectName === "string" && item.projectName.length <= 80 && typeof item.projectPath === "string" && item.projectPath.length <= 2048 && Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 && item.createdAt <= 8.64e15;
}
function saveList(key: string, items: unknown[]) {
  try { window.localStorage.setItem(key, JSON.stringify(items)); return true; }
  catch { return false; }
}
function voiceError(code: string) {
  if (code === "language-unavailable") return "That Windows speech language is not installed. Install it in Windows Speech settings or choose the other language.";
  if (code === "speech-engine-failed") return "Windows speech recognition could not start. Check microphone access, the selected speech language, and Windows Speech settings.";
  return "Local voice dictation is available only in the Windows desktop app.";
}

/** Explicit, local work handoffs. Dictation is push-to-talk and never saves audio. */
export function CheckpointsView({ onNotice }: { onNotice: (text: string, tone: "ok" | "error") => void }) {
  const bridge = shellBridge();
  const [projects, setProjects] = useState(() => readList(PROJECT_KEY, validProject, 12));
  const [items, setItems] = useState(() => readList(CHECKPOINT_KEY, validCheckpoint, MAX_CHECKPOINTS));
  const [title, setTitle] = useState("");
  const [next, setNext] = useState("");
  const [notes, setNotes] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [language, setLanguage] = useState<"en-US" | "hi-IN">("en-US");
  const [listening, setListening] = useState(false);
  const [voiceSupported] = useState(() => Boolean(bridge?.isDesktop && bridge.platform === "win32"));

  const selectedProject = useMemo(() => projects.find((project) => project.path === projectPath), [projects, projectPath]);

  useEffect(() => {
    const refreshProjects = () => setProjects(readList(PROJECT_KEY, validProject, 12));
    window.addEventListener("max:projects-updated", refreshProjects);
    window.addEventListener("storage", refreshProjects);
    return () => {
      window.removeEventListener("max:projects-updated", refreshProjects);
      window.removeEventListener("storage", refreshProjects);
    };
  }, []);

  useEffect(() => {
    if (!bridge?.onVoiceEvent) return undefined;
    const unsubscribe = bridge.onVoiceEvent((event: VoiceDictationEvent) => {
      if (event.type === "text" && typeof event.text === "string") {
        setNotes((current) => `${current}${current && !current.endsWith("\n") ? " " : ""}${event.text}`.slice(0, MAX_TEXT));
      } else if (event.type === "status") {
        setListening(event.state === "listening");
      } else {
        setListening(false);
        onNotice(voiceError(event.code ?? "speech-engine-failed"), "error");
      }
    });
    return () => {
      unsubscribe();
      bridge.stopVoiceCapture?.();
    };
  }, [bridge, onNotice]);

  async function startDictation() {
    if (!bridge?.startVoiceCapture) {
      onNotice(voiceError("unsupported"), "error");
      return;
    }
    try {
      const result = await bridge.startVoiceCapture(language);
      if (!result.ok) onNotice(result.message ?? voiceError("unsupported"), "error");
      else setListening(true);
    } catch {
      onNotice(voiceError("speech-engine-failed"), "error");
    }
  }

  async function stopDictation() {
    await bridge?.stopVoiceCapture?.();
    setListening(false);
  }

  function createCheckpoint() {
    const cleanTitle = title.trim().slice(0, 160);
    const cleanNext = next.trim().slice(0, 300);
    const cleanNotes = notes.trim().slice(0, MAX_TEXT);
    if (!cleanTitle) { onNotice("Add a short title for this work checkpoint.", "error"); return; }
    if (!cleanNext && !cleanNotes) { onNotice("Add a next step or a note before saving.", "error"); return; }
    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(), title: cleanTitle, next: cleanNext, notes: cleanNotes,
      projectName: selectedProject?.name ?? "", projectPath: selectedProject?.path ?? "", createdAt: Date.now(),
    };
    const updated = [checkpoint, ...items].slice(0, MAX_CHECKPOINTS);
    if (!saveList(CHECKPOINT_KEY, updated)) { onNotice("MAX couldn't save this checkpoint in the current browser profile.", "error"); return; }
    setItems(updated);
    setTitle(""); setNext(""); setNotes(""); setProjectPath("");
    onNotice("Work checkpoint saved on this device.", "ok");
  }

  async function resume(checkpoint: Checkpoint) {
    let folderOpened = false;
    let folderFailed = false;
    if (checkpoint.projectPath && bridge?.openProjectFolder) {
      try {
        const result = await bridge.openProjectFolder(checkpoint.projectPath);
        if (!result.ok) folderFailed = true;
        else folderOpened = true;
      } catch { folderFailed = true; }
    }
    const handoff = checkpoint.next || checkpoint.title;
    const copiedText = !bridge && checkpoint.projectPath
      ? `Project folder: ${checkpoint.projectPath}\\nNext step: ${handoff}`
      : handoff;
    try {
      await navigator.clipboard.writeText(copiedText);
      onNotice(folderFailed
        ? "Couldn't open the project folder; the next step is copied and the saved checkpoint is below."
        : folderOpened
          ? "Project folder opened; the next step is copied."
          : !bridge && checkpoint.projectPath
            ? "Project path and next step copied. Open the folder manually in this browser preview."
            : "Next step copied. Use the saved note below to pick up where you left off.", folderFailed ? "error" : "ok");
    } catch {
      onNotice(folderFailed ? "Couldn't open the folder. The saved checkpoint and next step are still below." : folderOpened ? "Project folder opened. Read the saved next step below." : "Read the saved next step below to resume.", folderFailed ? "error" : "ok");
    }
  }

  function removeCheckpoint(id: string) {
    const updated = items.filter((item) => item.id !== id);
    if (!saveList(CHECKPOINT_KEY, updated)) { onNotice("MAX couldn't update saved checkpoints.", "error"); return; }
    setItems(updated);
    onNotice("Checkpoint removed from this device.", "ok");
  }

  return <section className="section checkpoint" aria-labelledby="checkpoint-heading">
    <div className="section__head"><h3 className="section__title" id="checkpoint-heading">Work checkpoints</h3><span className="card__badge">{items.length}/{MAX_CHECKPOINTS} · local</span></div>
    <p className="hint">Save what you were doing and the next step. MAX stores only what you enter, on this device.</p>
    <div className="checkpoint-form">
      <label>Working on<input value={title} maxLength={160} placeholder="e.g. Finish the API tests" onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Project folder <select value={projectPath} onChange={(event) => setProjectPath(event.target.value)}><option value="">No project</option>{projects.map((project) => <option value={project.path} key={project.path}>{project.name}</option>)}</select></label>
      <label>Next step<input value={next} maxLength={300} placeholder="e.g. Add a test for the timeout" onChange={(event) => setNext(event.target.value)} /></label>
      <label>Notes<textarea value={notes} maxLength={MAX_TEXT} placeholder="Type context, decisions, or a short handoff…" onChange={(event) => setNotes(event.target.value)} /></label>
      <div className="checkpoint-voice">
        <label htmlFor="checkpoint-language">Dictation language</label>
        <select id="checkpoint-language" value={language} onChange={(event) => setLanguage(event.target.value as "en-US" | "hi-IN")} disabled={listening}>
          <option value="en-US">English (US)</option><option value="hi-IN">Hindi (India)</option>
        </select>
        {listening
          ? <button className="btn" data-variant="quiet" onClick={() => void stopDictation()} aria-pressed="true">Stop dictation</button>
          : <button className="btn" data-variant="quiet" onClick={() => void startDictation()} disabled={!voiceSupported} title={!voiceSupported ? "Offline dictation requires the Windows desktop app." : "Starts local Windows speech recognition; audio is not saved."}>Start local dictation</button>}
        <span className="hint" role="status" aria-live="polite">{listening ? "Listening on this device. Stop when finished; review the words before saving." : "Push to start; requires an installed Windows speech recognizer and microphone permission. No audio is saved."}</span>
      </div>
      <div className="checkpoint-actions"><button className="btn" data-variant="primary" onClick={createCheckpoint} disabled={listening}>Save checkpoint</button></div>
    </div>
    <div className="checkpoint-list">
      {items.length === 0 && <div className="empty">Nothing to resume yet. Save a small handoff above.</div>}
      {items.map((item) => <article className="checkpoint-card" key={item.id}>
        <div className="checkpoint-card__head"><strong>{item.title}</strong><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time></div>
        {item.projectName && <div className="hint">Project: {item.projectName}</div>}
        {item.next && <p><b>Next:</b> {item.next}</p>}
        {item.notes && <p className="checkpoint-notes">{item.notes}</p>}
        <div className="checkpoint-actions"><button className="btn" data-variant="quiet" onClick={() => void resume(item)}>Resume checkpoint</button><button className="text-link" onClick={() => removeCheckpoint(item.id)}>Done / remove</button></div>
      </article>)}
    </div>
  </section>;
}
