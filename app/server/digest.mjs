/**
 * The morning glance.
 *
 * Everything here is a pure function of what the app already knows, so it can be
 * tested without a clock, a network, or a user. The shape is deliberately flat:
 * a headline sentence, four numbers for today, yesterday's tally, and the tasks
 * that are still open.
 */

const sameDay = (iso, date) => {
  if (!iso) return false;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  return (
    value.getFullYear() === date.getFullYear() &&
    value.getMonth() === date.getMonth() &&
    value.getDate() === date.getDate()
  );
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Count activity entries into the handful of things a person cares about. */
function tally(activity, date) {
  const counts = { commands: 0, notes: 0, apps: 0, snippets: 0, scans: 0 };
  for (const entry of activity) {
    if (!sameDay(entry?.at, date)) continue;
    switch (entry.kind) {
      case "note":
        counts.notes += 1;
        break;
      case "app":
        counts.apps += 1;
        break;
      case "snippet":
        counts.snippets += 1;
        break;
      case "scan":
        counts.scans += 1;
        break;
      default:
        counts.commands += 1;
    }
  }
  return counts;
}

/** A sentence that reads like a person wrote it, not like a dashboard. */
export function headline({ today, yesterday, streak, tasks, numbers, captured = 0 }) {
  const bits = [];
  if (captured) bits.push(`${captured} thing${captured === 1 ? "" : "s"} captured`);
  if (today.commands + today.apps > 0) bits.push(`${today.commands + today.apps} things done today`);
  if (today.notes) bits.push(`${today.notes} ${today.notes === 1 ? "note" : "notes"}`);
  if (numbers?.leetcode?.streak) bits.push(`${numbers.leetcode.streak}-day LeetCode streak`);
  else if (streak) bits.push(`${streak}-day GitHub streak`);

  if (!bits.length) {
    const tidy = Number.isFinite(yesterday.commands) ? yesterday.commands + yesterday.apps : 0;
    if (tidy > 0) return `Quiet so far today. Yesterday you got through ${tidy} things.`;
    if (tasks.length) return `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} waiting — pick one.`;
    return "A fresh day. Say “capture …” and I'll keep it.";
  }

  const sentence = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}`;
  return `Today: ${sentence}.`;
}

/**
 * @param {object} input
 * @param {object} [input.stats]   the integrations payload (may be a placeholder)
 * @param {object[]} [input.activity] what the app has done
 * @param {object[]} [input.tasks] open `- [ ]` lines
 * @param {string[]} [input.entries] today's captured lines
 * @param {Date} [input.now]
 */
export function buildDigest({ stats = {}, activity = [], tasks = [], entries = [], now = new Date() } = {}) {
  const yesterdayDate = new Date(startOfDay(now).getTime() - 24 * 60 * 60 * 1000);
  const today = tally(activity, now);
  const yesterday = tally(activity, yesterdayDate);

  const numbers = {
    github: {
      commitsWeek: stats?.github?.commitsWeek ?? 0,
      commitsToday: stats?.github?.commitsToday ?? 0,
      streak: stats?.github?.streak ?? 0,
      openPrs: stats?.github?.openPrs ?? 0,
      demo: stats?.github?.demo ?? true,
    },
    leetcode: {
      solved: stats?.leetcode?.solved?.all ?? 0,
      streak: stats?.leetcode?.streak ?? 0,
      demo: stats?.leetcode?.demo ?? true,
    },
    render: {
      live: stats?.render?.services?.filter?.((service) => service.state === "live")?.length ?? 0,
      total: stats?.render?.services?.length ?? 0,
      demo: stats?.render?.demo ?? true,
    },
  };

  return {
    at: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    warming: Boolean(stats?.warming),
    headline: headline({ today, yesterday, streak: numbers.github.streak, tasks, numbers, captured: entries.length }),
    today,
    yesterday,
    tasks: tasks.slice(0, 12),
    captured: entries.slice(0, 8),
    capturedCount: entries.length,
    numbers,
  };
}

/** One line for the tray tooltip or a toast: the most useful thing, shortest form. */
export function digestLine(digest) {
  const bits = [];
  if (digest.today.commands + digest.today.apps) bits.push(`${digest.today.commands + digest.today.apps} actions`);
  if (digest.capturedCount) bits.push(`${digest.capturedCount} captured`);
  if (digest.tasks.length) bits.push(`${digest.tasks.length} open`);
  if (digest.numbers.leetcode.streak) bits.push(`${digest.numbers.leetcode.streak}d streak`);
  return bits.join(" · ") || "Nothing yet today";
}
