export type Tab = "now" | "code" | "stats" | "actions" | "settings";

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

export interface ContributionDay {
  date: string | null;
  level: number;
  count: number;
}

export interface Contributions {
  total: number;
  activeDays: number;
  streak: number;
  best: { date: string | null; count: number };
  days: { date: string; level: number; count: number }[];
  weeks: ContributionDay[][];
  monthly: { month: string; key: string; count: number }[];
}

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
  contributions?: Contributions | null;
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
  codeDir: string;
  prefs: {
    launchAtLogin: boolean;
    alwaysOnTop: boolean;
    reduceMotion: boolean;
    keepIslandOpen: boolean;
    idleSleepSeconds: number;
    language: string;
    lastSeenVersion: string;
  };
  github: { username: string; connected: boolean };
  leetcode: { username: string; connected: boolean };
  render: { connected: boolean };
  preset: { applied: boolean; owner?: string };
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

export type Severity = "error" | "warn" | "info";

export interface CodeIssue {
  rule: string;
  severity: Severity;
  title: string;
  hint?: string;
  fixable: boolean;
  line: number;
  message: string;
}

export interface CodeReview {
  ok: boolean;
  language: string;
  score: number;
  stats: { lines: number; characters: number; errors: number; warnings: number; hints: number };
  issues: CodeIssue[];
}

export interface CodeFixResult {
  ok: boolean;
  code: string;
  changed: boolean;
  message?: string;
  applied: { rule: string; title: string; count: number }[];
  review: CodeReview;
}

export interface CodeFile {
  ok: boolean;
  message?: string;
  path?: string;
  name?: string;
  language?: string;
  code?: string;
  size?: number;
  inWorkspace?: boolean;
}

export interface CodeLanguage {
  id: string;
  label: string;
  extensions: string[];
}

export interface ScanIssue {
  severity: Severity;
  title: string;
  line: number;
  message: string;
}

export interface ScanReport {
  path: string;
  name: string;
  language: string;
  score: number;
  errors: number;
  warnings: number;
  hints: number;
  issues: ScanIssue[];
}

export interface ScanResult {
  ok: boolean;
  message?: string;
  root?: string;
  score?: number;
  clean?: boolean;
  skipped?: number;
  summary?: { files: number; errors: number; warnings: number; hints: number; lines: number };
  languages?: { id: string; label: string; files: number }[];
  worst?: ScanReport[];
}

export interface SnippetEntry {
  name: string;
  size: number;
  lines: number;
  at: string;
}

export interface DiagnosticsPayload {
  version: string;
  summary: string;
  log: { at: string | null; level: string; message: string }[];
}

export interface CodeMeta {
  languages: CodeLanguage[];
  workspace: string;
  files: { name: string; path: string; language: string; size: number; modified: string }[];
}

export interface AppEntry {
  id: string;
  label: string;
  terms: string[];
  available?: boolean | null;
  how?: string | null;
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
  openCode?: { path: string; language: string; code: string };
  scan?: ScanResult;
  copy?: string;
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
