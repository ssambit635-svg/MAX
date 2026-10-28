import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "./store.mjs";

const execFileAsync = promisify(execFile);
const CACHE_MS = 60_000;
const cache = new Map();

async function cached(key, loader, ttl = CACHE_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url, { headers = {}, timeout = 8000, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "user-agent": "MAX-companion", accept: "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ demo */

const DEMO_GITHUB = {
  demo: true,
  login: "you",
  name: "Your GitHub",
  avatar: "",
  repos: 18,
  followers: 9,
  stars: 34,
  openPrs: 2,
  commitsToday: 6,
  commitsWeek: 31,
  streak: 4,
  languages: [
    { name: "TypeScript", pct: 46 },
    { name: "Python", pct: 28 },
    { name: "C#", pct: 16 },
    { name: "Other", pct: 10 },
  ],
  sparkline: [3, 6, 2, 8, 5, 1, 6],
  activity: [
    { title: "pushed 3 commits to main", repo: "max", at: new Date(Date.now() - 42 * 60000).toISOString() },
    { title: "opened pull request #12", repo: "max", at: new Date(Date.now() - 3 * 3600000).toISOString() },
    { title: "reviewed a pull request", repo: "portfolio", at: new Date(Date.now() - 26 * 3600000).toISOString() },
  ],
};

const DEMO_LEETCODE = {
  demo: true,
  username: "you",
  solved: { all: 214, easy: 96, medium: 94, hard: 24 },
  totals: { all: 3300, easy: 830, medium: 1750, hard: 720 },
  ranking: 184_320,
  streak: 5,
  todaySolved: 2,
  heatmap: [0, 1, 2, 0, 1, 3, 2, 0, 1, 1, 0, 2, 1, 0, 0, 1, 2, 1, 0, 3, 1, 0, 2, 1, 0, 1, 1, 2],
  recent: [
    { title: "Two Sum", difficulty: "Easy", at: new Date(Date.now() - 55 * 60000).toISOString() },
    { title: "Longest Substring Without Repeating Characters", difficulty: "Medium", at: new Date(Date.now() - 6 * 3600000).toISOString() },
  ],
};

const DEMO_RENDER = {
  demo: true,
  services: [
    { name: "max-api", type: "web_service", status: "live", deploy: "live", url: "https://max-api.onrender.com", updatedAt: new Date(Date.now() - 26 * 60000).toISOString() },
    { name: "portfolio", type: "static_site", status: "live", deploy: "live", url: "https://portfolio.onrender.com", updatedAt: new Date(Date.now() - 5 * 3600000).toISOString() },
    { name: "worker-jobs", type: "background_worker", status: "live", deploy: "live", url: "", updatedAt: new Date(Date.now() - 30 * 3600000).toISOString() },
  ],
  live: 3,
  total: 3,
};

/* --------------------------------------------------------------- github */

function monthDay(date) {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export { monthDay };

async function githubStats() {
  const config = loadConfig();
  const { username, token } = config.github;
  if (!username && !token) return DEMO_GITHUB;

  const headers = token ? { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" } : {};
  try {
    const user = await fetchJson("https://api.github.com/user", { headers }).catch(() => null);
    const login = username || user?.login;
    if (!login) return DEMO_GITHUB;

    const profile = user ?? (await fetchJson(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers }));
    const [repos, pulls, events] = await Promise.all([
      fetchJson(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`, { headers }).catch(() => []),
      fetchJson(`https://api.github.com/search/issues?q=${encodeURIComponent(`author:${login} is:pr is:open`)}&per_page=1`, { headers }).catch(() => null),
      fetchJson(`https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=60`, { headers }).catch(() => []),
    ]);

    const languages = new Map();
    for (const repo of Array.isArray(repos) ? repos : []) {
      if (!repo?.language) continue;
      languages.set(repo.language, (languages.get(repo.language) ?? 0) + 1);
    }
    const languageTotal = [...languages.values()].reduce((a, b) => a + b, 0) || 1;
    const languageList = [...languages.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => ({ name, pct: Math.round((count / languageTotal) * 100) }));

    const sparkline = Array.from({ length: 7 }, () => 0);
    let commitsToday = 0;
    let commitsWeek = 0;
    const todayKey = dayKey(new Date());
    const activity = [];
    for (const event of Array.isArray(events) ? events : []) {
      const when = new Date(event.created_at);
      const diffDays = Math.floor((Date.now() - when.getTime()) / 86_400_000);
      const commits = event.type === "PushEvent" ? event.payload?.commits?.length ?? 0 : 0;
      if (commits > 0) {
        commitsToday += dayKey(when) === todayKey ? commits : 0;
        commitsWeek += commits;
        if (diffDays >= 0 && diffDays < 7) sparkline[6 - diffDays] += commits;
      }
      if (activity.length < 4 && event.type && event.repo) {
        const label = {
          PushEvent: `pushed ${commits || 1} commit${(commits || 1) === 1 ? "" : "s"}`,
          PullRequestEvent: `${event.payload?.action ?? "updated"} a pull request`,
          IssuesEvent: `${event.payload?.action ?? "updated"} an issue`,
          WatchEvent: "starred a repository",
          CreateEvent: `created a ${event.payload?.ref_type ?? "repository"}`,
          PullRequestReviewEvent: "reviewed a pull request",
        }[event.type];
        if (label) activity.push({ title: label, repo: event.repo.name, at: event.created_at });
      }
    }

    return {
      demo: false,
      login,
      name: profile.name ?? login,
      avatar: profile.avatar_url ?? "",
      repos: profile.public_repos ?? 0,
      followers: profile.followers ?? 0,
      stars: (Array.isArray(repos) ? repos : []).reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0),
      openPrs: pulls?.total_count ?? 0,
      commitsToday,
      commitsWeek,
      streak: sparkline.filter((value) => value > 0).length,
      languages: languageList.length ? languageList : DEMO_GITHUB.languages,
      sparkline,
      activity,
    };
  } catch (error) {
    return { ...DEMO_GITHUB, note: `GitHub is unreachable: ${error.message}` };
  }
}

/* ------------------------------------------------------------- leetcode */

const LEETCODE_QUERY = `query userStats($username: String!) {
  matchedUser(username: $username) {
    username
    profile { ranking reputation }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    submissionCalendar
  }
  allQuestionsCount { difficulty count }
}`;

async function leetcodeStats() {
  const { username } = loadConfig().leetcode;
  if (!username) return DEMO_LEETCODE;
  try {
    const data = await fetchJson("https://leetcode.com/graphql/", {
      method: "POST",
      headers: { "content-type": "application/json", referer: `https://leetcode.com/${username}/` },
      body: JSON.stringify({ query: LEETCODE_QUERY, variables: { username } }),
    });
    const matched = data?.data?.matchedUser;
    if (!matched) return { ...DEMO_LEETCODE, note: "LeetCode username not found — check Settings." };

    const acList = matched.submitStatsGlobal?.acSubmissionNum ?? [];
    const pick = (difficulty) => acList.find((entry) => entry.difficulty === difficulty)?.count ?? 0;
    const totals = data?.data?.allQuestionsCount ?? [];
    const totalFor = (difficulty) => totals.find((entry) => entry.difficulty === difficulty)?.count ?? 0;

    let calendar = {};
    try {
      calendar = JSON.parse(matched.submissionCalendar ?? "{}");
    } catch {
      calendar = {};
    }
    const days = Object.keys(calendar)
      .map((stamp) => ({ day: dayKey(Number(stamp) * 1000), count: calendar[stamp] }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const byDay = new Map(days.map((entry) => [entry.day, entry.count]));
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const key = dayKey(Date.now() - i * 86_400_000);
      if ((byDay.get(key) ?? 0) > 0) streak++;
      else if (i > 0) break;
    }

    const last28 = Array.from({ length: 28 }, (_, index) => byDay.get(dayKey(Date.now() - (27 - index) * 86_400_000)) ?? 0);

    return {
      demo: false,
      username,
      solved: { all: pick("All"), easy: pick("Easy"), medium: pick("Medium"), hard: pick("Hard") },
      totals: { all: totalFor("All"), easy: totalFor("Easy"), medium: totalFor("Medium"), hard: totalFor("Hard") },
      ranking: matched.profile?.ranking ?? 0,
      reputation: matched.profile?.reputation ?? 0,
      streak,
      todaySolved: byDay.get(dayKey(new Date())) ?? 0,
      heatmap: last28,
      recent: DEMO_LEETCODE.recent,
    };
  } catch (error) {
    return { ...DEMO_LEETCODE, note: `LeetCode is unreachable: ${error.message}` };
  }
}

/* --------------------------------------------------------------- render */

async function renderStats() {
  const { apiKey } = loadConfig().render;
  if (!apiKey) return DEMO_RENDER;
  try {
    const services = await fetchJson("https://api.render.com/v1/services?limit=20", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const list = (Array.isArray(services) ? services : []).map((entry) => entry.service ?? entry);
    const detailed = await Promise.all(
      list.slice(0, 6).map(async (service) => {
        const deploys = await fetchJson(`https://api.render.com/v1/services/${service.id}/deploys?limit=1`, {
          headers: { authorization: `Bearer ${apiKey}` },
        }).catch(() => []);
        const deploy = (Array.isArray(deploys) ? deploys : [])[0]?.deploy ?? (Array.isArray(deploys) ? deploys[0] : null);
        return {
          name: service.name,
          type: service.type,
          status: service.suspended === "suspended" ? "suspended" : "live",
          deploy: deploy?.status ?? "unknown",
          url: service.serviceDetails?.url ?? "",
          updatedAt: deploy?.finishedAt ?? deploy?.createdAt ?? service.updatedAt ?? new Date().toISOString(),
        };
      }),
    );
    return {
      demo: false,
      services: detailed,
      live: detailed.filter((service) => service.status === "live").length,
      total: list.length,
    };
  } catch (error) {
    return { ...DEMO_RENDER, note: `Render is unreachable: ${error.message}` };
  }
}

/* --------------------------------------------------------------- vscode */

function workspaceStorageDir() {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Code", "User", "workspaceStorage");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Code", "User", "workspaceStorage");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "Code", "User", "workspaceStorage");
}

function prettyPath(uri) {
  try {
    const clean = decodeURIComponent(uri.replace(/^file:\/\//, ""));
    return process.platform === "win32" ? clean.replace(/^\//, "") : clean;
  } catch {
    return uri;
  }
}

async function isVsCodeRunning() {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq Code.exe", "/NH"], { timeout: 2500 });
      return stdout.toLowerCase().includes("code.exe");
    }
    const { stdout } = await execFileAsync("pgrep", ["-fl", "Code Helper|code-insiders|/code "], { timeout: 2500 });
    return Boolean(stdout.trim());
  } catch {
    return false;
  }
}

async function vscodeStats() {
  const dir = workspaceStorageDir();
  const recent = [];
  try {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = path.join(dir, entry.name);
        return { full, stat: fs.statSync(full) };
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, 6);

    for (const entry of entries) {
      const metaFile = path.join(entry.full, "workspace.json");
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        const uri = meta.folder ?? meta.workspace;
        if (!uri) continue;
        const full = prettyPath(uri);
        recent.push({ name: path.basename(full) || full, path: full, modified: entry.stat.mtime.toISOString() });
      } catch {
        /* skip folders that were never opened */
      }
    }
  } catch {
    /* no VS Code install, or nothing opened yet */
  }

  const running = await isVsCodeRunning();
  if (!recent.length && !running) {
    return {
      demo: true,
      running: false,
      workspace: "max-companion",
      recent: [
        { name: "max-companion", path: "~/dev/max", modified: new Date(Date.now() - 12 * 60000).toISOString() },
        { name: "portfolio", path: "~/dev/portfolio", modified: new Date(Date.now() - 9 * 3600000).toISOString() },
      ],
    };
  }
  return { demo: false, running, workspace: recent[0]?.name ?? "", recent };
}

/* --------------------------------------------------------------- system */

let lastCpu = os.cpus().map((cpu) => cpu.times);

function systemStats() {
  const now = os.cpus().map((cpu) => cpu.times);
  let idle = 0;
  let total = 0;
  now.forEach((times, index) => {
    const prev = lastCpu[index] ?? times;
    const delta = Object.keys(times).reduce((sum, key) => sum + (times[key] - prev[key]), 0);
    total += delta;
    idle += times.idle - prev.idle;
  });
  lastCpu = now;
  const cpu = total > 0 ? Math.round(((total - idle) / total) * 100) : 0;
  return {
    cpu: Math.min(100, Math.max(0, cpu)),
    memUsed: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    memTotalGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    uptimeHours: Math.round(os.uptime() / 3600),
    platform: process.platform,
    hostname: os.hostname(),
  };
}

export async function collectStats() {
  return cached("stats", async () => {
    const [github, leetcode, render, vscode] = await Promise.all([githubStats(), leetcodeStats(), renderStats(), vscodeStats()]);
    return { at: new Date().toISOString(), github, leetcode, render, vscode, system: systemStats() };
  });
}

export function invalidateStats() {
  cache.clear();
}
