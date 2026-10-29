import type {
  AppEntry,
  CodeFile,
  CodeFixResult,
  CodeMeta,
  CodeReview,
  CommandResult,
  NoteEntry,
  PublicConfig,
  StatePayload,
  Stats,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body means the service is restarting; the caller shows its own text.
    data = {};
  }
  if (!response.ok) {
    const message = (data as { message?: string }).message;
    throw new Error(message ?? "MAX didn't respond. Try that again.");
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
  apps: () => request<{ apps: AppEntry[] }>("/api/apps"),
  codeMeta: () => request<CodeMeta>("/api/code/meta"),
  codeReview: (code: string, language: string) =>
    request<CodeReview>("/api/code/review", { method: "POST", body: JSON.stringify({ code, language }) }),
  codeFix: (code: string, language: string) =>
    request<CodeFixResult>("/api/code/fix", { method: "POST", body: JSON.stringify({ code, language }) }),
  codeOpen: (path: string) => request<CodeFile>("/api/code/open", { method: "POST", body: JSON.stringify({ path }) }),
  codeSave: (path: string, code: string) =>
    request<CodeFile>("/api/code/save", { method: "POST", body: JSON.stringify({ path, code }) }),
  config: (patch: Record<string, unknown>) =>
    request<{ ok: boolean; config: PublicConfig; stats: Stats }>("/api/config", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  verify: (provider: string, values: Record<string, string>) =>
    request<{ ok: boolean; message: string }>("/api/integrations/verify", {
      method: "POST",
      body: JSON.stringify({ provider, ...values }),
    }),
  disconnect: (provider: string) =>
    request<{ ok: boolean; config: PublicConfig; stats: Stats }>("/api/integrations/disconnect", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),
};
