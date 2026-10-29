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


/* ------------------------------------------------------- contributions */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** GitHub's own contribution calendar, parsed from the public profile fragment. */
export function parseContributionCalendar(html) {
  // 1) every <td> that describes a day
  const cells = [];
  const tagRe = /<td\b[^>]*>/g;
  let tag;
  while ((tag = tagRe.exec(html))) {
    const text = tag[0];
    const date = /data-date="(\d{4}-\d{2}-\d{2})"/.exec(text);
    if (!date) continue;
    const level = /data-level="(\d)"/.exec(text);
    const id = /id="([^"]+)"/.exec(text);
    cells.push({
      date: date[1],
      level: level ? Number(level[1]) : 0,
      id: id ? id[1] : null,
    });
  }
  if (!cells.length) return null;

  // 2) the sibling tool-tip holds the exact count in words
  const counts = new Map();
  const tipRe = /<tool-tip\b[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g;
  let tip;
  while ((tip = tipRe.exec(html))) {
    const label = tip[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const counted = /^(\d+)\s+contribution/.exec(label);
    counts.set(tip[1], counted ? Number(counted[1]) : 0);
  }

  // GitHub emits the grid row by row, so de-duplicate by date and sort into a real calendar.
  const byDate = new Map();
  for (const cell of cells) {
    const count = cell.id ? counts.get(cell.id) ?? 0 : 0;
    byDate.set(cell.date, { date: cell.date, level: cell.level, count });
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const total = days.reduce((sum, day) => sum + day.count, 0);
  const active = days.filter((day) => day.count > 0).length;
  const best = days.reduce((top, day) => (day.count > top.count ? day : top), { date: null, count: 0 });

  // current streak: walk backwards from the most recent day
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    const isToday = i === days.length - 1;
    if (day.count > 0) streak++;
    else if (isToday) continue; // today can be empty without breaking the streak
    else break;
  }

  // pad to whole weeks (Sunday first) so the frontend can render a grid
  const firstDow = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const padded = [...Array(firstDow).fill({ date: null, level: 0, count: 0, pad: true }), ...days];
  while (padded.length % 7 !== 0) padded.push({ date: null, level: 0, count: 0, pad: true });

  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  const monthly = {};
  for (const day of days) {
    const key = day.date.slice(0, 7);
    monthly[key] = (monthly[key] ?? 0) + day.count;
  }

  return {
    total,
    activeDays: active,
    best,
    streak,
    days: days.map(({ date, level, count }) => ({ date, level, count })),
    weeks,
    monthly: Object.entries(monthly)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, count]) => ({ month: `${MONTHS[Number(month.slice(5, 7)) - 1]}`, key: month, count })),
  };
}

async function fetchContributions(login, headers) {
  try {
    const response = await fetch(`https://github.com/users/${encodeURIComponent(login)}/contributions`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MAX-companion)", accept: "text/html", ...headers },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return null;
    return parseContributionCalendar(await response.text());
  } catch {
    return null;
  }
}

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
    const [repos, pulls, events, contributions] = await Promise.all([
      fetchJson(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`, { headers }).catch(() => []),
      fetchJson(`https://api.github.com/search/issues?q=${encodeURIComponent(`author:${login} is:pr is:open`)}&per_page=1`, { headers }).catch(() => null),
      fetchJson(`https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=60`, { headers }).catch(() => []),
      fetchContributions(login, headers),
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
      commitsToday: contributions
        ? contributions.days.find((day) => day.date === dayKey(new Date()))?.count ?? 0
        : commitsToday,
      commitsWeek: contributions ? contributions.days.slice(-7).reduce((sum, day) => sum + day.count, 0) : commitsWeek,
      streak: contributions?.streak ?? sparkline.filter((value) => value > 0).length,
      contributions,
      languages: languageList.length ? languageList : DEMO_GITHUB.languages,
      sparkline: contributions ? contributions.days.slice(-7).map((day) => day.count) : sparkline,
      activity,
    };
  } catch (error) {
    return {
      demo: true,
      login: username || "github",
      name: username || "GitHub",
      avatar: "",
      repos: 0,
      followers: 0,
      stars: 0,
      openPrs: 0,
      commitsToday: 0,
      commitsWeek: 0,
      streak: 0,
      languages: [],
      sparkline: [0, 0, 0, 0, 0, 0, 0],
      contributions: null,
      activity: [],
      note: "GitHub isn't answering right now. I'll try again in a minute.",
    };
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

function emptyLeetcode(username, note) {
  return {
    demo: true,
    username,
    note,
    solved: { all: 0, easy: 0, medium: 0, hard: 0 },
    totals: { all: 0, easy: 0, medium: 0, hard: 0 },
    ranking: 0,
    streak: 0,
    todaySolved: 0,
    heatmap: Array(28).fill(0),
    recent: [],
  };
}

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
    if (!matched) return emptyLeetcode(username, `LeetCode has no user called “${username}”. Check the handle in Settings.`);

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
    return emptyLeetcode(username, "LeetCode isn't answering right now. I'll try again in a minute.");
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
    return { ...DEMO_RENDER, note: "Render isn't answering right now. I'll try again in a minute." };
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


/* --------------------------------------------------------- verify connect */

const GITHUB_TOKEN_DOCS = "https://github.com/settings/tokens";

/**
 * Checks credentials *before* they are saved, so Settings can say "connected as @you"
 * or the exact reason it failed, instead of silently storing a wrong key.
 */
const PROVIDER_LABEL = { github: "GitHub", leetcode: "LeetCode", render: "Render", vscode: "VS Code" };

export async function verifyIntegration(provider, input = {}) {
  try {
    if (provider === "github") {
      const username = String(input.username ?? "").trim();
      const token = String(input.token ?? "").trim();
      if (!username && !token) return { ok: false, message: "Enter your GitHub username first." };

      const headers = token ? { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" } : {};
      if (token) {
        let me;
        try {
          me = await fetchJson("https://api.github.com/user", { headers });
        } catch (error) {
          const status = String(error.message ?? "");
          if (status.startsWith("401")) {
            return { ok: false, message: "GitHub rejected that token (401). It may be expired, revoked, or mistyped — generate a new one." };
          }
          if (status.startsWith("403")) {
            return { ok: false, message: "GitHub refused the request (403). Usually a rate limit or a token without the public_repo scope." };
          }
          throw error;
        }
        return {
          ok: true,
          message: `Token is valid — connected as @${me.login}${username && username !== me.login ? ` (showing @${username})` : ""}.`,
          resolved: { login: me.login, name: me.name ?? me.login },
        };
      }
      try {
        const profile = await fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers });
        return {
          ok: true,
          message: `Found @${profile.login} — ${profile.public_repos} public repos. Public data only, no token needed.`,
          resolved: { login: profile.login, name: profile.name ?? profile.login },
        };
      } catch (error) {
        if (String(error.message).startsWith("404")) {
          return { ok: false, message: `GitHub has no user called “${username}”. Check the spelling — it is the part after github.com/.` };
        }
        throw error;
      }
    }

    if (provider === "leetcode") {
      const username = String(input.username ?? "").trim();
      if (!username) return { ok: false, message: "Enter your LeetCode handle first." };
      const data = await fetchJson("https://leetcode.com/graphql/", {
        method: "POST",
        headers: { "content-type": "application/json", referer: `https://leetcode.com/${username}/` },
        body: JSON.stringify({ query: LEETCODE_QUERY, variables: { username } }),
      });
      const matched = data?.data?.matchedUser;
      if (!matched) {
        return { ok: false, message: `LeetCode has no user called “${username}”. It is the part after leetcode.com/u/.` };
      }
      const solved = matched.submitStatsGlobal?.acSubmissionNum?.find((entry) => entry.difficulty === "All")?.count ?? 0;
      return { ok: true, message: `Found @${matched.username} — ${solved} problems solved.`, resolved: { username: matched.username } };
    }

    if (provider === "render") {
      const apiKey = String(input.apiKey ?? "").trim();
      if (!apiKey) return { ok: false, message: "Paste a Render API key first." };
      try {
        const services = await fetchJson("https://api.render.com/v1/services?limit=1", {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        const count = Array.isArray(services) ? services.length : 0;
        return { ok: true, message: `Render key works — ${count > 0 ? "services found" : "key accepted, no services yet"}.` };
      } catch (error) {
        if (/40[13]/.test(String(error.message))) {
          return { ok: false, message: "Render rejected that key. Create a new one under Account Settings → API Keys." };
        }
        throw error;
      }
    }

    return { ok: false, message: `Unknown integration “${provider}”.` };
  } catch (error) {
    return { ok: false, message: `${PROVIDER_LABEL[provider] ?? "That service"} didn't answer. Check your connection and try again.` };
  }
}

export { GITHUB_TOKEN_DOCS };

export async function collectStats() {
  return cached("stats", async () => {
    const [github, leetcode, render, vscode] = await Promise.all([githubStats(), leetcodeStats(), renderStats(), vscodeStats()]);
    return { at: new Date().toISOString(), github, leetcode, render, vscode, system: systemStats() };
  });
}

export function invalidateStats() {
  cache.clear();
}
