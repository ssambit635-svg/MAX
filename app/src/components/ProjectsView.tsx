import { useEffect, useState } from "react";
import { shellBridge } from "../lib/shell";

type Project = { name: string; path: string };
const STORAGE_KEY = "max.project-launchers.v1";

function readProjects(): Project[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Project => item && typeof item.name === "string" && typeof item.path === "string" && item.name.length <= 80 && item.path.length <= 2048).slice(0, 12);
  } catch { return []; }
}

/** Local bookmarks for project folders. No folder is read or uploaded by MAX. */
export function ProjectsView({ onNotice }: { onNotice: (text: string, tone: "ok" | "error") => void }) {
  const [projects, setProjects] = useState<Project[]>(readProjects);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const bridge = shellBridge();

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); }
    catch { onNotice("MAX couldn't save project shortcuts in this browser profile.", "error"); }
  }, [projects]);

  async function chooseFolder() {
    if (!bridge) {
      onNotice("Project folder picking is available in the MAX desktop app.", "error");
      return;
    }
    const result = await bridge.chooseProjectFolder();
    if (result.ok && result.path) {
      setFolder(result.path);
      if (!name.trim()) setName(result.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Project");
    }
  }

  function save() {
    const cleanName = name.trim().slice(0, 80);
    const cleanPath = folder.trim();
    if (!cleanName || !cleanPath || cleanPath.length > 2048) {
      onNotice("Choose a folder and give this project a short name.", "error");
      return;
    }
    const next = [{ name: cleanName, path: cleanPath }, ...projects.filter((project) => project.path !== cleanPath)].slice(0, 12);
    setProjects(next);
    setName("");
    setFolder("");
    onNotice(`Saved ${cleanName} on this device.`, "ok");
  }

  async function open(project: Project) {
    if (!bridge) {
      try { await navigator.clipboard.writeText(project.path); onNotice("Folder path copied. Open it in Explorer or your editor.", "ok"); }
      catch { onNotice("Open this folder in your desktop MAX app: " + project.path, "error"); }
      return;
    }
    const result = await bridge.openProjectFolder(project.path);
    onNotice(result.ok ? `Opened ${project.name} in your file manager.` : result.message ?? "Couldn't open that project folder.", result.ok ? "ok" : "error");
  }

  return <div className="section">
    <div className="section__head"><h3 className="section__title">Project shortcuts</h3><span className="card__badge">{projects.length}/12 · on this device</span></div>
    <p className="hint">Save folders you return to often. MAX stores only the name and path; it does not scan or upload project files.</p>
    <div className="project-form">
      <input aria-label="Project name" value={name} maxLength={80} placeholder="Project name" onChange={(event) => setName(event.target.value)} />
      <button className="btn" data-variant="quiet" onClick={() => void chooseFolder()}>Choose folder…</button>
      <span className="project-path" title={folder}>{folder || "No folder selected"}</span>
      <button className="btn" data-variant="primary" disabled={!name.trim() || !folder || projects.length >= 12 && !projects.some((project) => project.path === folder)} onClick={save}>Save shortcut</button>
    </div>
    {projects.length > 0 ? <div className="project-list">{projects.map((project) => <div className="project-row" key={project.path}>
      <button className="project-open" onClick={() => void open(project)}><strong>{project.name}</strong><small title={project.path}>{project.path}</small></button>
      <button className="text-link" aria-label={`Remove ${project.name}`} onClick={() => setProjects((items) => items.filter((item) => item.path !== project.path))}>remove</button>
    </div>)}</div> : <div className="empty">Your saved project folders will appear here.</div>}
  </div>;
}
