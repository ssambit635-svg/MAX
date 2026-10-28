import type { CommandResult, NoteEntry, PublicConfig, StatePayload, Stats } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  state: () => request<StatePayload>("/api/state"),
  stats: (force = false) => request<Stats>(`/api/stats${force ? "?force=1" : ""}`),
  command: (input: string) => request<CommandResult>("/api/command", { method: "POST", body: JSON.stringify({ input }) }),
  saveNote: (text: string, name?: string) =>
    request<{ ok: boolean; message: string; notes: NoteEntry[] }>("/api/notes", {
      method: "POST",
      body: JSON.stringify({ text, name }),
    }),
  notes: () => request<{ notes: NoteEntry[] }>("/api/notes"),
  config: (patch: Record<string, unknown>) =>
    request<{ ok: boolean; config: PublicConfig; stats: Stats }>("/api/config", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  setMood: (mood: string, caption: string) =>
    request<{ ok: boolean }>("/api/mood", { method: "POST", body: JSON.stringify({ mood, caption }) }),
  mood: () => request<{ mood: string; caption: string; at: string }>("/api/mood"),
  disconnect: (provider: string) =>
    request<{ ok: boolean; config: PublicConfig; stats: Stats }>("/api/integrations/disconnect", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),
};
