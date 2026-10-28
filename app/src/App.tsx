import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pet } from "./components/Pet";
import { NowView } from "./components/NowView";
import { StatsView } from "./components/StatsView";
import { ActionsView } from "./components/ActionsView";
import { SettingsView } from "./components/SettingsView";
import { StarterCard } from "./components/StarterCard";
import { api } from "./lib/api";
import { filterSuggestions, type Suggestion } from "./lib/commands";
import { greeting } from "./lib/format";
import { inDesktopShell, shellBridge } from "./lib/shell";
import { useWindowDrag } from "./lib/useWindowDrag";
import type { CommandResult, IntegrationId, Mood, StatePayload, Tab } from "./lib/types";

const TABS: { id: Tab; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "stats", label: "Stats" },
  { id: "actions", label: "Actions" },
  { id: "settings", label: "Settings" },
];

const MOOD_COPY: Record<Mood, string> = {
  idle: "ready when you are",
  listening: "listening",
  thinking: "working on it",
  working: "in focus",
  happy: "on it",
  sleepy: "resting",
  error: "needs a hand",
  celebrate: "nice one",
};

const IS_SHELL =
  inDesktopShell() ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("shell") === "desktop");

export default function App() {
  const [state, setState] = useState<StatePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>("now");
  const [mood, setMood] = useState<Mood>("idle");
  const [caption, setCaption] = useState("");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [highlight, setHighlight] = useState<IntegrationId | null>(null);
  const [focusUntil, setFocusUntil] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [starterHidden, setStarterHidden] = useState(() => {
    try {
      return window.localStorage.getItem("max.starter.dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [, forceTick] = useState(0);

  const drag = useWindowDrag();
  const inputRef = useRef<HTMLInputElement>(null);
  const moodTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const lastActionAt = useRef(Date.now());
  const sseAlive = useRef(false);

  /* -------------------------------------------------------------- bootstrap */

  const load = useCallback(async () => {
    try {
      const payload = await api.state();
      setState(payload);
      setLoadError(null);
      setCaption(
        payload.activity[0]?.detail ??
          `${greeting()}. Ask me for something small — open an app, save a note, check your stats.`,
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "MAX could not reach its local service.");
    }
  }, []);

  useEffect(() => {
    void load();
    document.body.dataset.shell = IS_SHELL ? "desktop" : "browser";
  }, [load]);

  // The desktop shell hugs the island: the window grows and shrinks with the panel.
  useEffect(() => {
    shellBridge()?.setMode(expanded ? "expanded" : "collapsed");
  }, [expanded]);

  useEffect(() => {
    const bridge = shellBridge();
    if (!bridge) return;
    const offPalette = bridge.onOpenPalette(() => {
      setExpanded(true);
      window.setTimeout(() => inputRef.current?.focus(), 260);
    });
    const offCollapse = bridge.onCollapse(() => setExpanded(false));
    return () => {
      offPalette();
      offCollapse();
    };
  }, []);

  useEffect(() => {
    document.body.dataset.motion = state?.config.prefs.reduceMotion ? "reduced" : "animated";
  }, [state?.config.prefs.reduceMotion]);

  useEffect(() => {
    if (!state) return;
    const id = window.setInterval(async () => {
      try {
        const stats = await api.stats();
        setState((prev) => (prev ? { ...prev, stats } : prev));
      } catch {
        /* keep the last good numbers */
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [state !== null]);

  /* ------------------------------------------------------------------ live */

  useEffect(() => {
    let source: EventSource | null = null;
    let retry = 0;
    const connect = () => {
      source = new EventSource("/api/events");
      source.addEventListener("hello", () => {
        sseAlive.current = true;
      });
      source.addEventListener("activity", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          activity: StatePayload["activity"];
        };
        setState((prev) => (prev ? { ...prev, activity: payload.activity } : prev));
      });
      source.addEventListener("notes", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { notes: StatePayload["notes"] };
        setState((prev) => (prev ? { ...prev, notes: payload.notes } : prev));
      });
      source.onerror = () => {
        sseAlive.current = false;
        source?.close();
        retry = Math.min(retry + 1, 6);
        window.setTimeout(connect, retry * 1200);
      };
    };
    connect();
    return () => {
      sseAlive.current = false;
      source?.close();
    };
  }, []);

  /* --------------------------------------------------------------- idleness */

  useEffect(() => {
    const id = window.setInterval(() => {
      const idleSeconds = (Date.now() - lastActionAt.current) / 1000;
      const limit = state?.config.prefs.idleSleepSeconds ?? 120;
      if (focusUntil && Date.now() < focusUntil) {
        setMood("working");
        return;
      }
      if (idleSeconds > limit) setMood((current) => (current === "working" ? current : "sleepy"));
      else setMood((current) => (current === "sleepy" ? "idle" : current));
      forceTick((tick) => tick + 1);
    }, 5000);
    return () => window.clearInterval(id);
  }, [state?.config.prefs.idleSleepSeconds, focusUntil]);

  useEffect(() => {
    if (!focusUntil) return;
    const id = window.setInterval(() => {
      if (Date.now() >= focusUntil) {
        setFocusUntil(null);
        setMood("celebrate");
        setCaption("Focus block finished. Stand up, stretch, blink.");
        window.setTimeout(() => setMood("idle"), 6000);
      }
      forceTick((tick) => tick + 1);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [focusUntil]);

  /* ------------------------------------------------------------------ gaze */

  useEffect(() => {
    if (state?.config.prefs.reduceMotion) return;
    let frame = 0;
    const onMove = (event: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
        const y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1));
        setGaze({ x, y });
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [state?.config.prefs.reduceMotion]);

  /* --------------------------------------------------------------- helpers */

  const flashMood = useCallback((next: Mood, hold = 3200) => {
    if (moodTimer.current) window.clearTimeout(moodTimer.current);
    setMood(next);
    if (next === "error" || next === "happy" || next === "celebrate") {
      moodTimer.current = window.setTimeout(() => setMood((current) => (current === next ? "idle" : current)), hold);
    }
  }, []);

  const showToast = useCallback((text: string, tone: "ok" | "error") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const glowCard = useCallback((target: IntegrationId | null) => {
    if (!target) return;
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    setHighlight(target);
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 3600);
  }, []);

  const dismissStarter = useCallback(() => {
    setStarterHidden(true);
    try {
      window.localStorage.setItem("max.starter.dismissed", "1");
    } catch {
      /* private mode — the guide just comes back next launch */
    }
  }, []);

  const runCommand = useCallback(
    async (raw: string) => {
      const command = raw.trim();
      if (!command || busy) return;
      lastActionAt.current = Date.now();
      setBusy(true);
      setMood("thinking");
      setCaption(`“${command}”`);
      try {
        const result: CommandResult = await api.command(command);
        showToast(result.message, result.ok ? "ok" : "error");
        if (result.ui?.tab) {
          setTab(result.ui.tab);
          setExpanded(true);
        }
        if (result.ui?.highlight) glowCard(result.ui.highlight);
        if (result.ui?.focusMinutes) {
          setFocusUntil(Date.now() + result.ui.focusMinutes * 60_000);
          setTab("now");
          setExpanded(true);
        }
        if (result.ui?.composer === "note") {
          setTab("now");
          setExpanded(true);
          setNoteOpen(true);
        }
        if (result.ui?.sleep) {
          setExpanded(false);
          setMood("sleepy");
          setCaption("Resting. Poke me when you need something.");
        } else {
          setCaption(result.message);
          flashMood(result.mood ?? (result.ok ? "happy" : "error"));
        }
        if (result.ui?.savedNote) {
          const notes = await api.notes();
          setState((prev) => (prev ? { ...prev, notes: notes.notes } : prev));
          setNoteText("");
          setNoteOpen(false);
        }
        if (!sseAlive.current) {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  activity: [
                    {
                      id: `${Date.now()}`,
                      at: new Date().toISOString(),
                      kind: result.ok ? "command" : "error",
                      title: command,
                      detail: result.message,
                    },
                    ...prev.activity,
                  ].slice(0, 60),
                }
              : prev,
          );
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "That didn't work.", "error");
        flashMood("error");
      } finally {
        setBusy(false);
      }
    },
    [busy, flashMood, glowCard, showToast],
  );

  const saveNote = useCallback(async () => {
    const text = noteText.trim();
    if (!text || busy) return;
    setBusy(true);
    lastActionAt.current = Date.now();
    try {
      const result = await api.saveNote(text);
      showToast(result.message, "ok");
      setState((prev) => (prev ? { ...prev, notes: result.notes } : prev));
      setNoteText("");
      setNoteOpen(false);
      setCaption(result.message);
      flashMood("celebrate", 3600);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That note didn't save.", "error");
      flashMood("error");
    } finally {
      setBusy(false);
    }
  }, [busy, flashMood, noteText, showToast]);

  const applyConfig = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      try {
        const result = await api.config(patch);
        setState((prev) => (prev ? { ...prev, config: result.config, stats: result.stats } : prev));
        showToast("Saved.", "ok");
        flashMood("happy", 2000);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not save that.", "error");
        flashMood("error");
      } finally {
        setBusy(false);
      }
    },
    [flashMood, showToast],
  );

  const disconnect = useCallback(
    async (provider: string) => {
      setBusy(true);
      try {
        const result = await api.disconnect(provider);
        setState((prev) => (prev ? { ...prev, config: result.config, stats: result.stats } : prev));
        showToast(`${provider} disconnected.`, "ok");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not disconnect.", "error");
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  /* -------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setExpanded(true);
        window.setTimeout(() => inputRef.current?.focus(), 120);
        return;
      }
      if (event.key === "Escape") {
        if (noteOpen) {
          setNoteOpen(false);
          return;
        }
        if (expanded) setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, noteOpen]);

  /* ------------------------------------------------------------ suggestions */

  const suggestions: Suggestion[] = useMemo(() => {
    const extra: Suggestion[] =
      state?.apps.map((app) => ({ cmd: `open ${app.terms[0]}`, desc: app.label, group: "Apps" })) ?? [];
    return filterSuggestions(input, extra);
  }, [input, state?.apps]);

  useEffect(() => setSuggestIndex(0), [input]);

  const submitInput = () => {
    const chosen = suggestions[suggestIndex]?.cmd ?? input;
    const command = input.trim() ? (input.trim() === chosen ? chosen : input) : chosen;
    if (!command) return;
    void runCommand(command);
    setInput("");
  };

  /* ----------------------------------------------------------------- render */

  if (!state) {
    return (
      <div className="stage">
        <div className="island" data-pulse={!loadError}>
          <div className="pill">
            <span className="pill__pet">
              <Pet mood={loadError ? "error" : "sleepy"} size={30} compact />
            </span>
            <span className="pill__name">MAX</span>
            <span className="pill__divider" />
            <span className="pill__status">
              <span className="pill__dot" style={{ background: loadError ? "var(--red)" : undefined }} />
              {loadError ? "offline" : "waking up…"}
            </span>
          </div>
        </div>
        <div className="footer-note">
          {loadError ? `Local service unreachable — ${loadError}` : "Starting the island service…"}
        </div>
      </div>
    );
  }

  const focusMinutesLeft = focusUntil ? Math.max(0, Math.round((focusUntil - Date.now()) / 60000)) : 0;
  const statusText = focusUntil ? `${focusMinutesLeft}m focus left` : MOOD_COPY[mood];

  return (
    <div className="stage">
      <div className="stage__inner">
        <div className="island" data-expanded={expanded} data-pulse={mood === "working" || mood === "celebrate"}>
          <button
            className="pill"
            type="button"
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
            onClick={() => {
              if (drag.consumedDrag()) return;
              setExpanded(true);
              lastActionAt.current = Date.now();
              if (mood === "sleepy") setMood("idle");
              window.setTimeout(() => inputRef.current?.focus(), 220);
            }}
            aria-label="Open MAX"
          >
            <span className="pill__pet">
              <Pet mood={mood} size={34} compact gaze={gaze} />
            </span>
            <span className="pill__name">MAX</span>
            <span className="pill__divider" />
            <span className="pill__status">
              <span className="pill__dot" data-mood={mood} />
              {statusText}
            </span>
            <span className="pill__cta">Open</span>
            <span className="pill__chevron">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <div className="panel">
            <div className="panel__clip">
              <div className="panel__top">
                <div className="brand">
                  <Pet
                    mood={mood}
                    size={44}
                    compact
                    gaze={gaze}
                    onPoke={() => {
                      lastActionAt.current = Date.now();
                      setCaption("Hey. I'm here.");
                      flashMood("happy", 1800);
                    }}
                  />
                  <div className="brand__text">
                    <span className="brand__name">MAX</span>
                    <span className="brand__sub">desktop companion · {statusText}</span>
                  </div>
                </div>

                <nav className="tabs" role="tablist">
                  {TABS.map((entry) => (
                    <button
                      key={entry.id}
                      className="tab"
                      data-active={tab === entry.id}
                      role="tab"
                      aria-selected={tab === entry.id}
                      onClick={() => {
                        setTab(entry.id);
                        lastActionAt.current = Date.now();
                      }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </nav>

                <button className="icon-btn" onClick={() => setExpanded(false)} aria-label="Collapse">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M3 9.5 7 5.5l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <div className="panel__body">
                {tab === "now" && !starterHidden && state.activity.length === 0 && (
                  <StarterCard
                    state={state}
                    busy={busy}
                    onRun={(command) => void runCommand(command)}
                    onNote={() => {
                      setNoteOpen(true);
                      setTab("now");
                    }}
                    onDismiss={dismissStarter}
                  />
                )}
                {tab === "now" && (
                  <NowView
                    state={state}
                    mood={mood}
                    caption={caption}
                    gaze={gaze}
                    focusUntil={focusUntil}
                    noteOpen={noteOpen}
                    noteText={noteText}
                    busy={busy}
                    onNoteText={setNoteText}
                    onSaveNote={() => void saveNote()}
                    onCloseNote={() => setNoteOpen(false)}
                    onRun={(command) => void runCommand(command)}
                    onPoke={() => {
                      lastActionAt.current = Date.now();
                      setCaption("That tickles. What do you need?");
                      flashMood("celebrate", 2000);
                    }}
                    onOpenNote={() => {
                      setNoteOpen(true);
                      setTab("now");
                    }}
                  />
                )}
                {tab === "stats" && (
                  <StatsView
                    stats={state.stats}
                    highlight={highlight}
                    onConnect={() => setTab("settings")}
                  />
                )}
                {tab === "actions" && <ActionsView apps={state.apps} onRun={(command) => void runCommand(command)} />}
                {tab === "settings" && (
                  <SettingsView
                    config={state.config}
                    busy={busy}
                    onConfig={(patch) => void applyConfig(patch)}
                    onDisconnect={(provider) => void disconnect(provider)}
                    onVerify={(provider, values) => api.verify(provider, values)}
                    onNotice={showToast}
                  />
                )}
              </div>

              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitInput();
                }}
              >
                {input.trim().length > 0 && suggestions.length > 0 && (
                  <div className="suggest">
                    {suggestions.map((suggestion, index) => (
                      <button
                        type="button"
                        key={`${suggestion.group}-${suggestion.cmd}`}
                        className="suggest__item"
                        data-active={index === suggestIndex}
                        onMouseEnter={() => setSuggestIndex(index)}
                        onClick={() => {
                          setInput("");
                          void runCommand(suggestion.cmd);
                        }}
                      >
                        <span className="suggest__key">{suggestion.cmd}</span>
                        <span className="suggest__desc">{suggestion.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="composer__row">
                  <span className="composer__prefix">›</span>
                  <input
                    ref={inputRef}
                    className="composer__input"
                    value={input}
                    placeholder="open chrome · save note … · stats github"
                    onChange={(event) => {
                      setInput(event.target.value);
                      lastActionAt.current = Date.now();
                      setMood((current) => (current === "sleepy" ? "listening" : current));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSuggestIndex((index) => Math.min(index + 1, suggestions.length - 1));
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSuggestIndex((index) => Math.max(index - 1, 0));
                      } else if (event.key === "Tab" && suggestions.length > 0) {
                        event.preventDefault();
                        setInput(suggestions[suggestIndex]?.cmd ?? input);
                      }
                    }}
                    aria-label="Command"
                  />
                  {busy ? (
                    <span className="pill__status" style={{ fontSize: 10.5 }}>
                      <span className="pill__dot" /> working
                    </span>
                  ) : (
                    <span className="kbd">↵</span>
                  )}
                </div>
              </form>
            </div>
          </div>

          <div className="toast" data-show={toast !== null} data-tone={toast?.tone}>
            <span className="toast__dot" />
            {toast?.text}
          </div>
        </div>
      </div>

      <div className="footer-note">
        <span className="kbd">⌘K</span> open · <span className="kbd">esc</span> close ·{" "}
        {IS_SHELL ? "living on your desktop" : "browser preview of the desktop island"}
      </div>
    </div>
  );
}
