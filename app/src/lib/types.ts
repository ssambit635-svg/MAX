export type Tab = "now" | "stats" | "actions" | "settings";

export type Mood =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "happy"
  | "sleepy"
  | "error"
  | "celebrate";

export type IntegrationId = "github" | "leetcode" | "render" | "vscode" | "system";

export interface GithubStats {
  demo: boolean;
  note?: string;
  login: string;
  name: string;
  avatar: string;
  repos: number;
  followers: number;
  stars: number;
  openPrs: number;
  commitsToday: number;
  commitsWeek: number;
  streak: number;
  languages: { name: string; pct: number }[];
  sparkline: number[];
  activity: { title: string; repo: string; at: string }[];
}

export interface LeetcodeStats {
  demo: boolean;
  note?: string;
  username: string;
  solved: { all: number; easy: number; medium: number; hard: number };
  totals: { all: number; easy: number; medium: number; hard: number };
  ranking: number;
  streak: number;
  todaySolved: number;
  heatmap: number[];
  recent: { title: string; difficulty: string; at: string }[];
}

export interface RenderStats {
  demo: boolean;
  note?: string;
  services: {
    name: string;
    type: string;
    status: string;
    deploy: string;
    url: string;
    updatedAt: string;
  }[];
  live: number;
  total: number;
}

export interface VscodeStats {
  demo: boolean;
  running: boolean;
  workspace: string;
  recent: { name: string; path: string; modified: string }[];
}

export interface SystemStats {
  cpu: number;
  memUsed: number;
  memTotalGb: number;
  uptimeHours: number;
  platform: string;
  hostname: string;
}

export interface Stats {
  at: string;
  github: GithubStats;
  leetcode: LeetcodeStats;
  render: RenderStats;
  vscode: VscodeStats;
  system: SystemStats;
}

export interface PublicConfig {
  saveDir: string;
  prefs: {
    petOnDesktop: boolean;
    launchAtLogin: boolean;
    reduceMotion: boolean;
    keepIslandOpen: boolean;
    idleSleepSeconds: number;
  };
  github: { username: string; connected: boolean };
  leetcode: { username: string; connected: boolean };
  render: { connected: boolean };
}

export interface ActivityEntry {
  id: string;
  at: string;
  kind: "command" | "note" | "error" | string;
  title: string;
  detail?: string;
}

export interface NoteEntry {
  name: string;
  path: string;
  modified: string;
  size: number;
}

export interface AppEntry {
  id: string;
  label: string;
  terms: string[];
}

export interface StatePayload {
  version: string;
  config: PublicConfig;
  stats: Stats;
  activity: ActivityEntry[];
  notes: NoteEntry[];
  apps: AppEntry[];
  platform: string;
}

export interface CommandUi {
  tab?: Tab;
  highlight?: IntegrationId;
  composer?: "note";
  savedNote?: { file: string; name: string };
  launched?: { id: string; label: string };
  focusMinutes?: number;
  timerMinutes?: number;
  sleep?: boolean;
}

export interface CommandResult {
  ok: boolean;
  message: string;
  mood?: Mood;
  ui?: CommandUi;
}
