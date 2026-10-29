import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CodeFixResult, CodeIssue, CodeLanguage, CodeMeta, CodeReview, Severity } from "../lib/types";

interface CodeViewProps {
  onNotice?: (text: string, tone: "ok" | "error") => void;
}

const SAMPLE = `def greet(name):
    if name == None:
        return "hello, stranger"
    try:
        return f"hello, {name}"
    except:
        return "hello"
`;

const SEVERITY_LABEL: Record<Severity, string> = { error: "error", warn: "warning", info: "hint" };

export function CodeView({ onNotice }: CodeViewProps) {
  const [meta, setMeta] = useState<CodeMeta | null>(null);
  const [language, setLanguage] = useState("python");
  const [code, setCode] = useState(SAMPLE);
  const [path, setPath] = useState("");
  const [review, setReview] = useState<CodeReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [openPath, setOpenPath] = useState("");
  const [showOpen, setShowOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const check = useCallback(
    async (source = code, lang = language) => {
      setBusy(true);
      try {
        const result = await api.codeReview(source, lang);
        setReview(result);
      } catch {
        onNotice?.("I couldn't check that file. Try again.", "error");
      } finally {
        setBusy(false);
      }
    },
    [code, language, onNotice],
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .codeMeta()
      .then((result) => {
        if (!cancelled) setMeta(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // First look at the sample so the tab never opens empty.
  useEffect(() => {
    void check(SAMPLE, "python");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const languages: CodeLanguage[] = meta?.languages ?? [];

  const openFile = async (target: string) => {
    if (!target.trim()) return;
    setBusy(true);
    try {
      const result = await api.codeOpen(target.trim());
      if (!result.ok) {
        onNotice?.(result.message ?? "I couldn't open that file.", "error");
        return;
      }
      setCode(result.code ?? "");
      setPath(result.path ?? target);
      setLanguage(result.language ?? "text");
      setDirty(false);
      setShowOpen(false);
      setOpenPath("");
      setReview(null);
      await check(result.code ?? "", result.language ?? "text");
      onNotice?.(`Opened ${result.name}.`, "ok");
    } catch {
      onNotice?.("I couldn't open that file.", "error");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!path.trim()) {
      onNotice?.("Give the file a name first — for example hello.py.", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await api.codeSave(path.trim(), code);
      if (!result.ok) {
        onNotice?.(result.message ?? "I couldn't save that file.", "error");
        return;
      }
      setPath(result.path ?? path);
      setDirty(false);
      onNotice?.(`Saved ${result.name}.`, "ok");
      const refreshed = await api.codeMeta().catch(() => null);
      if (refreshed) setMeta(refreshed);
    } catch {
      onNotice?.("I couldn't save that file.", "error");
    } finally {
      setBusy(false);
    }
  };

  const fix = async () => {
    setBusy(true);
    try {
      const result: CodeFixResult = await api.codeFix(code, language);
      if (!result.ok) {
        onNotice?.(result.message ?? "I didn't change anything.", "error");
        return;
      }
      if (!result.changed) {
        onNotice?.("Nothing safe to fix automatically.", "ok");
        return;
      }
      setCode(result.code);
      setDirty(true);
      setReview(result.review);
      const count = result.applied.reduce((sum, entry) => sum + entry.count, 0);
      onNotice?.(`Fixed ${count} thing${count === 1 ? "" : "s"}: ${result.applied.map((entry) => entry.title).join(", ")}.`, "ok");
    } catch {
      onNotice?.("I couldn't apply the fixes.", "error");
    } finally {
      setBusy(false);
    }
  };

  const lineNumbers = useMemo(() => Array.from({ length: code.split("\n").length }, (_value, index) => index + 1), [code]);

  const jumpTo = (issue: CodeIssue) => {
    setActiveLine(issue.line);
    const textarea = editorRef.current;
    if (!textarea) return;
    const lines = code.split("\n");
    const offset = lines.slice(0, issue.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(offset, offset + (lines[issue.line - 1]?.length ?? 0));
  };

  const score = review?.score ?? 100;
  const tone = score >= 90 ? "good" : score >= 70 ? "warn" : "bad";

  return (
    <div className="view code">
      <div className="code__bar">
        <select
          className="input code__lang"
          value={language}
          onChange={(event) => {
            setLanguage(event.target.value);
            void check(code, event.target.value);
          }}
          aria-label="Language"
        >
          {(languages.length ? languages : [{ id: "python", label: "Python", extensions: [] }]).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>

        <input
          className="input code__path"
          value={path}
          placeholder="hello.py — or paste a full path"
          onChange={(event) => setPath(event.target.value)}
          aria-label="File"
        />

        <button className="btn" onClick={() => void check()} disabled={busy}>
          Check
        </button>
        <button className="btn" data-variant="primary" onClick={() => void fix()} disabled={busy}>
          Fix
        </button>
        <button className="btn" onClick={() => void save()} disabled={busy}>
          Save
        </button>
        <button className="icon-btn" onClick={() => setShowOpen((value) => !value)} aria-label="Open a file">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 3.5h4l1 1.5h6v6.5h-11z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {showOpen && (
        <div className="code__open">
          <input
            className="input"
            value={openPath}
            placeholder={meta?.workspace ? `${meta.workspace}\\main.py` : "C:\\Users\\you\\project\\main.py"}
            onChange={(event) => setOpenPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void openFile(openPath);
            }}
            aria-label="Path to open"
          />
          <button className="btn" onClick={() => void openFile(openPath)} disabled={busy}>
            Open
          </button>
          {meta?.files?.length ? (
            <div className="code__recent">
              {meta.files.slice(0, 5).map((file) => (
                <button key={file.path} className="chip" onClick={() => void openFile(file.path)} title={file.name}>
                  {file.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="code__hint">New files are created in your workspace folder.</div>
          )}
        </div>
      )}

      <div className="code__editor">
        <div className="code__gutter" aria-hidden>
          {lineNumbers.map((line) => (
            <span key={line} data-active={activeLine === line} data-flagged={review?.issues.some((issue) => issue.line === line) || undefined}>
              {line}
            </span>
          ))}
        </div>
        <textarea
          ref={editorRef}
          className="code__area"
          value={code}
          spellCheck={false}
          onChange={(event) => {
            setCode(event.target.value);
            setDirty(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void check();
            }
            if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void save();
            }
            if (event.key === "Tab") {
              event.preventDefault();
              const target = event.currentTarget;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              const next = `${code.slice(0, start)}  ${code.slice(end)}`;
              setCode(next);
              setDirty(true);
              requestAnimationFrame(() => target.setSelectionRange(start + 2, start + 2));
            }
          }}
          aria-label="Code editor"
        />
      </div>

      <div className="code__footer">
        <div className="code__score" data-tone={tone}>
          <span className="code__score-value">{score}</span>
          <span className="code__score-label">score</span>
        </div>
        <div className="code__counts">
          <span data-kind="error">{review?.stats.errors ?? 0} errors</span>
          <span data-kind="warn">{review?.stats.warnings ?? 0} warnings</span>
          <span data-kind="info">{review?.stats.hints ?? 0} hints</span>
        </div>
        <span className="code__saved">{dirty ? "unsaved" : path ? "saved" : "scratch"}</span>
      </div>

      <div className="code__issues">
        {review && review.issues.length === 0 && <div className="empty">Nothing to fix. This file reads clean.</div>}
        {review?.issues.map((issue, index) => (
          <button className="issue" key={`${issue.rule}-${issue.line}-${index}`} onClick={() => jumpTo(issue)} data-severity={issue.severity}>
            <span className="issue__line">{issue.line}</span>
            <span className="issue__body">
              <span className="issue__title">
                {issue.title}
                {issue.fixable && <span className="issue__auto">auto-fix</span>}
              </span>
              <span className="issue__message">{issue.message}</span>
              {issue.hint && <span className="issue__hint">{issue.hint}</span>}
            </span>
            <span className="issue__severity">{SEVERITY_LABEL[issue.severity]}</span>
          </button>
        ))}
      </div>

      <div className="code__hint">
        {review ? `${review.stats.lines} lines · ${review.stats.characters} characters · ` : ""}
        runs offline in the island — check ⌘/Ctrl + Enter, save ⌘/Ctrl + S.
      </div>
    </div>
  );
}
