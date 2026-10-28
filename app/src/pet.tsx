import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Pet } from "./components/Pet";
import { api } from "./lib/api";
import { shellBridge } from "./lib/shell";
import type { Mood } from "./lib/types";
import "./styles.css";

const SLEEP_AFTER_MS = 150_000;

/**
 * The free-floating desktop pet. It mirrors the island's mood over the local
 * event stream, naps when nothing happens, and opens the island when clicked.
 */
function DesktopPet() {
  const [mood, setMood] = useState<Mood>("idle");
  const [caption, setCaption] = useState("");
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [bubble, setBubble] = useState(false);
  const lastPing = useRef(Date.now());
  const pokeCount = useRef(0);
  const pokeTimer = useRef<number | null>(null);

  useEffect(() => {
    document.body.dataset.shell = "pet";
    void api
      .mood()
      .then((value) => {
        setMood((value.mood as Mood) ?? "idle");
        setCaption(value.caption ?? "");
      })
      .catch(() => setMood("sleepy"));

    let source: EventSource | null = null;
    let retry = 0;
    const connect = () => {
      source = new EventSource("/api/events");
      source.addEventListener("mood", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { mood: Mood; caption: string };
        setMood(payload.mood ?? "idle");
        setCaption(payload.caption ?? "");
        lastPing.current = Date.now();
      });
      source.onerror = () => {
        source?.close();
        retry = Math.min(retry + 1, 5);
        window.setTimeout(connect, retry * 1500);
      };
    };
    connect();
    return () => source?.close();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - lastPing.current > SLEEP_AFTER_MS) setMood((current) => (current === "working" ? current : "sleepy"));
    }, 6000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
      const y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1));
      setGaze({ x, y });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    if (!bubble) return;
    const id = window.setTimeout(() => setBubble(false), 5200);
    return () => window.clearTimeout(id);
  }, [bubble, caption]);

  const poke = useCallback(() => {
    pokeCount.current += 1;
    if (pokeTimer.current) window.clearTimeout(pokeTimer.current);
    pokeTimer.current = window.setTimeout(() => {
      pokeCount.current = 0;
    }, 900);

    if (pokeCount.current >= 3) {
      pokeCount.current = 0;
      setMood("celebrate");
      setBubble(true);
      window.setTimeout(() => setMood("idle"), 4200);
      return;
    }

    setMood("happy");
    setBubble(true);
    window.setTimeout(() => setMood((current) => (current === "happy" ? "idle" : current)), 2600);
  }, []);

  const bridge = shellBridge();

  return (
    <div
      className="desktop-pet"
      onDoubleClick={() => {
        bridge?.setMode("expanded");
        bridge?.openIsland();
      }}
    >
      {bubble && caption && <div className="desktop-pet__bubble">{caption}</div>}
      <Pet mood={mood} size={168} gaze={gaze} onPoke={poke} />
    </div>
  );
}

const container = document.getElementById("pet-root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <DesktopPet />
    </StrictMode>,
  );
}
