export interface Suggestion {
  cmd: string;
  desc: string;
  group: string;
}

export const BASE_SUGGESTIONS: Suggestion[] = [
  { cmd: "open chrome", desc: "Browser", group: "Apps" },
  { cmd: "open vs code", desc: "Editor", group: "Apps" },
  { cmd: "open notepad", desc: "Scratchpad", group: "Apps" },
  { cmd: "open terminal", desc: "Shell", group: "Apps" },
  { cmd: "open explorer", desc: "Files", group: "Apps" },
  { cmd: "search github for vite", desc: "Web", group: "Search" },
  { cmd: "search leetcode", desc: "Web", group: "Search" },
  { cmd: "search youtube for lofi", desc: "Web", group: "Search" },
  { cmd: "save note <text>", desc: "Markdown file", group: "Notes" },
  { cmd: "new note", desc: "Composer", group: "Notes" },
  { cmd: "focus 25", desc: "Pomodoro block", group: "Focus" },
  { cmd: "stats", desc: "All integrations", group: "Insight" },
  { cmd: "stats github", desc: "Commits & PRs", group: "Insight" },
  { cmd: "stats leetcode", desc: "Solved & streak", group: "Insight" },
  { cmd: "stats render", desc: "Deploys", group: "Insight" },
  { cmd: "stats vscode", desc: "Workspaces", group: "Insight" },
  { cmd: "help", desc: "Everything I can do", group: "Insight" },
];

export function filterSuggestions(input: string, extra: Suggestion[] = []): Suggestion[] {
  const all = [...extra, ...BASE_SUGGESTIONS];
  const needle = input.trim().toLowerCase();
  if (!needle) return all.slice(0, 6);
  const scored = all
    .map((item) => {
      const cmd = item.cmd.toLowerCase();
      let score = -1;
      if (cmd.startsWith(needle)) score = 100;
      else if (cmd.includes(needle)) score = 60;
      else {
        const words = needle.split(/\s+/).filter(Boolean);
        const hits = words.filter((word) => cmd.includes(word)).length;
        if (hits) score = 20 + hits * 10;
        else if (item.desc.toLowerCase().includes(needle)) score = 12;
      }
      return { item, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return scored.map((entry) => entry.item);
}
