/**
 * Release notes that ship inside the app.
 *
 * Newest first. The Settings panel opens the newest entry automatically once per
 * version — `prefs.lastSeenVersion` decides whether it has been read.
 */

export interface Release {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

export const RELEASES: Release[] = [
  {
    version: "0.4.2",
    date: "2026-10-29",
    title: "Smaller island, smoother fold",
    changes: [
      "Dragging works again — a leftover call from the old animation code was crashing the window.",
      "The island rests smaller, so it takes less of the screen.",
      "Opening and closing are one gesture each: the shape moves, then the content follows.",
      "Closing glides with no bounce; opening settles with a small one.",
    ],
  },
  {
    version: "0.4.1",
    date: "2026-10-29",
    title: "The island opens like it should",
    changes: [
      "Opening and closing no longer gets stuck half-way.",
      "The island springs open into a window that already fits it, instead of a window stuttering open around it.",
      "Closing folds the panel first, so the tabs are never squeezed.",
      "The pet morphs into the panel instead of vanishing.",
      "No invisible strip under the panel swallowing clicks any more.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-29",
    title: "Folder scans, snippets and updates",
    changes: [
      "Scan a whole folder with one click, or say “scan ~/project”.",
      "“check ~/project/main.py” opens the file in the Code tab with its issues listed.",
      "Save reusable snippets: “save snippet debounce: …”, then “snippet debounce” copies it.",
      "Add your own apps: “add app Figma: C:\\…\\Figma.exe”, then “open Figma”.",
      "The installed app now updates itself from GitHub releases.",
      "Diagnostics report you can copy — tokens, e-mail and folder paths are stripped first.",
      "Hindi and English for the island chrome; pick one in Settings.",
    ],
  },
  {
    version: "0.3.2",
    date: "2026-10-27",
    title: "Tidier insides",
    changes: [
      "Launch-at-login and always-on-top switches now actually do something.",
      "Removed dead styles and unused code so the island stays light.",
      "Esc closes the island unless you asked it to stay open.",
      "Added a Quit button in Settings.",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-10-25",
    title: "Code tab",
    changes: [
      "Review Python, JavaScript, TypeScript, CSS, HTML, JSON and Markdown offline.",
      "Auto-fix only the safe things, and only when you press Fix.",
      "Syntax colours that stay in step with the editor.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-24",
    title: "Real accounts",
    changes: [
      "GitHub, LeetCode and Render stats straight from your own accounts.",
      "The green contribution graph is read from GitHub, not invented.",
      "Every app in the Actions tab is checked against what is installed.",
    ],
  },
];

export const latestRelease = (): Release => RELEASES[0];

/** True when this install has not shown the notes for `version` yet. */
export const shouldAnnounce = (version: string, seen: string | undefined): boolean =>
  Boolean(version) && version !== seen && RELEASES.some((release) => release.version === version);
