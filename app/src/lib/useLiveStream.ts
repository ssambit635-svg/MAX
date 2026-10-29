import { useEffect, useRef } from "react";
import type { StatePayload } from "./types";

interface LiveHandlers {
  onActivity: (activity: StatePayload["activity"]) => void;
  onNotes: (notes: StatePayload["notes"]) => void;
  onStats?: (stats: StatePayload["stats"]) => void;
}

/**
 * Server-sent events keep the island live: a command run anywhere (tray, hotkey,
 * another window) updates the activity list and the saved notes without polling.
 *
 * Reconnects with a growing backoff, and exposes whether the stream is currently
 * up so callers can fall back to local updates while it is down.
 */
export function useLiveStream({ onActivity, onNotes, onStats }: LiveHandlers) {
  const alive = useRef(false);
  const handlers = useRef<LiveHandlers>({ onActivity, onNotes, onStats });
  handlers.current = { onActivity, onNotes };

  useEffect(() => {
    let source: EventSource | null = null;
    let retry = 0;
    let stopped = false;
    let timer: number | undefined;

    const connect = () => {
      if (stopped) return;
      source = new EventSource("/api/events");

      source.addEventListener("hello", () => {
        alive.current = true;
        retry = 0;
      });

      source.addEventListener("activity", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { activity: StatePayload["activity"] };
          handlers.current.onActivity(payload.activity);
        } catch {
          /* a malformed frame must never break the stream */
        }
      });

      source.addEventListener("notes", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { notes: StatePayload["notes"] };
          handlers.current.onNotes(payload.notes);
        } catch {
          /* ignore */
        }
      });

      // Numbers that were still loading when the island first drew arrive here.
      source.addEventListener("stats", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { stats: StatePayload["stats"] };
          handlers.current.onStats?.(payload.stats);
        } catch {
          /* ignore */
        }
      });

      source.onerror = () => {
        alive.current = false;
        source?.close();
        retry = Math.min(retry + 1, 6);
        timer = window.setTimeout(connect, retry * 1200);
      };
    };

    connect();

    return () => {
      stopped = true;
      alive.current = false;
      if (timer) window.clearTimeout(timer);
      source?.close();
    };
  }, []);

  return alive;
}
