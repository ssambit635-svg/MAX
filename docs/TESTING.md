# Testing MAX 0.4.0

Everything added after 0.3.2, one feature at a time. Each block has **Do**, **Expect** and
**If it fails** — so a bad result tells you which file to look at instead of "it's broken".

Test order matters: the first block proves the install is sane, the rest can be done in any order.

---

## 0. Before you start (2 minutes)

**Do**

```powershell
cd app
npm install
npm test
```

**Expect** — `189` lines starting with `PASS`, ending with `the app survives the gauntlet`, exit code 0.
The eight suites are integrations (10), apps (21), code engine (40), highlight (7), codebase (10),
tools (14), and the product checks (9), shell checks (9), and the production gauntlet (68). `SKIP esbuild unavailable` on the highlight suite means
you ran files before `npm install` — rerun it.

**The three commands that matter**

| Command | What it proves | Time |
| --- | --- | --- |
| `npm run qa` | typecheck, a real UI build, and all 68 hostile checks | ~35 s |
| `npm run qa:fast` | the 68 checks without the build (skips tsc and vite) | ~8 s |
| `npm run qa:loop` | the same battery on every save while you work | watching |

A failing check prints the file, the input and what actually happened, so the fix is
usually one line. The gauntlet keeps its own scratch folder and never writes to your
Documents.

**Do** — `npm run desktop` (builds the UI and opens the real app), or for a quick look at the UI
only: `npm start` then open `http://127.0.0.1:7999`.

To look at the UI through a proxy or from another device, the service has to be told
it is allowed: `MAX_HOST=0.0.0.0 MAX_TRUSTED_HOSTS=the-proxy-host npm start`. Without
those two variables MAX only answers on loopback, and only for itself.

**Expect** — the small island at the top of the screen, pet breathing, click it and it opens
slowly with a spring settle.

**If it fails** — `npm test` failing at "version numbers agree" means `package.json` and
`package-lock.json` drifted; run `npm install --package-lock-only`.

---

## 1. Folder-wide scan (the biggest new feature)

### 1a. From the island

**Do** — open the island → **Code** tab → press **Scan folder**.

**Expect**
- the button reads `Scanning…` for a moment, then a panel appears above the issue list
- a score number on the left (green ≥ 90, amber ≥ 70, red below), then
  `22 files · 0 errors · 6 warnings`
- up to five rows, worst first: file name, its first issue, and its score in the matching colour
- clicking a row loads that file into the editor and reviews it

**If it fails** — an empty panel with a red score means the scan ran but scored badly; no panel at
all means the request failed and you should see a toast. Server side:
`server/code/project.mjs` (walk) and `POST /api/code/scan` in `server/index.mjs`.

### 1b. From the keyboard

**Do** — type `scan src` and press Enter (from the island root, `app/`).

**Expect** — toast: `Scanned 22 files, score 97 — 0 errors, 6 warnings, 9 hints. Worst is styles.css at 70: !important.`
and the Code tab opens with the same panel.

Also try:
- `scan` (no path) — uses your Code folder from Settings, or the current folder
- `audit .` — same thing, alias
- `scan C:\does\not\exist` → `That folder doesn't exist.` and nothing changes

**If it fails** — a score of 0 with thousands of files means the ignore list is not working; check
`collectFiles` in `server/code/project.mjs` (it must skip `node_modules`, `.git`, dotfiles, and cap
at 400 files / 512 KB each / depth 6).

### 1c. The thing this fixed

**Do** — `check app/src/App.tsx`, then `check app/src/components/StatsView.tsx`.

**Expect** — `App.tsx is clean. Score 100.` (or a real issue, not a fake one). Before 0.4.0 these
files reported **"String never closed"** because the scanner read JSX apostrophes and `<T>` generics
as strings. If you see a fake string error, the old masker is back — `server/code/syntax.mjs`.

---

## 2. `check <path>` — one file, from anywhere

**Do** — `check src/lib/i18n.ts`

**Expect** — `i18n.ts is clean. Score 100.`, the Code tab opens with that file loaded (path filled,
language set to TypeScript) and its issue list refreshed.

**Do** — `check` with no path. **Expect** the file already in the editor is re-reviewed.

**Do** — `check .env` or `check C:\Windows\System32\cmd.exe`

**Expect** — refused in plain words (`That looks like a secrets file…` / `That folder belongs to the
system…`), no file read, editor untouched.

**If it fails** — the tab opens but stays on the sample file: the hand-off between the command result
and the tab (`ui.openCode` → `App.tsx` → `CodeView` `initial` prop) is broken.

---

## 3. Snippets

**Do**

```
save snippet debounce: const d = (f, ms) => setTimeout(f, ms)
snippets
snippet debounce
delete snippet debounce
```

**Expect**, in order:
1. `Saved snippet “debounce”. Say “snippet debounce” to copy it.`
2. `You have 1 snippet(s): debounce.`
3. `“debounce” copied — 1 line(s).` — paste somewhere to confirm the code is really on the clipboard
4. `Deleted snippet “debounce”.`

**Do** — save one again (`save snippet fetch: …`), open the **Code** tab. **Expect** a chip row of
snippet names with `click to copy · say “save snippet name: code”`. Click a chip → clipboard + toast.

**Do** — save the same name twice with different code, then `snippet <name>`.

**Expect** the second save says `Updated snippet …` and only one entry exists (no duplicates).

**Do** — `save snippet a/b: test` → refused (`Snippet names can't contain slashes.`)

**Do** — close and reopen the app, then `snippets`. **Expect** it is still there
(`%APPDATA%\MAX\state\snippets.json`, 0600).

**If it fails** — snippets vanish after restart: the state folder is not writable, or
`MAX_STATE_DIR` points somewhere else in your shell.

---

## 4. Your own app shortcuts (Windows)

**Do** — `add app Figma: C:\Users\<you>\AppData\Local\Figma\Figma.exe` with a real path.

**Expect** — `Added “Figma”. Say “open Figma”.` Then:
- `open figma` launches it
- the **Actions** tab shows it and it launches from the card too
- `remove app Figma` → `Removed “Figma”.` and it disappears from Actions

**Do** — the four refusals:

| Command | Expect |
| --- | --- |
| `add app Notepad: C:\Windows\System32\notepad.exe` | `That path is inside a system folder, so I won't add it.` |
| `add app X: C:\Windows\notepad.exe` | refused (Windows folder) |
| `add app X: C:\Users\you\notes.txt` | `That file doesn't look like a program.` |
| `add app notepad: C:\…\some.exe` | refused, name collides with a built-in |
| `remove app notepad` | `“notepad” is built in, so it always stays.` |

**If it fails** — it appears in Actions but `open` says unknown: the resolver is reading the built-in
list only (`findApp` in `server/apps.mjs` must use `allApps()`).

---

## 5. Auto-update

### In the development build (what you have now)

**Do** — Settings → **Check for updates**.

**Expect** — `Updates only work in an installed build.` Dev builds never contact GitHub. This is the
correct result, not a failure.

### In the installed build

**Do** — install the artifact from the Actions run, open Settings → **Check for updates**.

**Expect** one of:
- `You're on the newest version.`
- `Version 0.4.x is downloading.` → `Downloading update — 42%.` → `Version 0.4.x is ready. Restart to install.`
- the tray menu grows a **Restart to install 0.4.x** item (only when one is ready)

**Expect** the update installs when you press it, or when you quit MAX. Never mid-command.

**If it fails** — `I couldn't check for updates just now.`: the release has no `latest.yml`, or the
release is a **draft**. Publish the release (not draft, not prerelease). Tray item missing after a
download means `refreshTrayMenu` was not called on the `update-downloaded` event.

---

## 6. Diagnostics (no telemetry)

**Do** — Settings → **Copy a diagnostics report**, then paste into Notepad.

**Expect** something like:

```
MAX 0.4.0
node v22.22.3 · electron 33.x · chrome 130.x
platform win32 x64 · 10.0.22631
cpu … × 8
memory 16 GB
host YOURPC · uptime 128s
state dir «path»/…/state
github handle set + token
leetcode handle set
render not set
custom apps 0
prefs launchAtLogin=false alwaysOnTop=true reduceMotion=false …
stats demo=false github=ssambit635-svg repos=13 streak=10
recent log: …
```

**The three things to check**
1. no token anywhere (`ghp_…`, `rnd_…` → `«github-token»`, `«render-key»`)
2. no e-mail (`«email»`)
3. no folder names — paths become `«path»/…/filename.ext`

**Do** — break something on purpose (disconnect the network, hit Stats), then reopen the report.
**Expect** a `recent log:` line naming the failure, redacted.

**Expect** the log file at `%APPDATA%\MAX\state\logs\max.log` and it to rotate at 256 KB.

**If it fails** — the report is empty: `diagnosticsSummary` threw (it must never throw); a real
token visible in it is a security bug, report it immediately.

---

## 7. What's new

**Do** — fresh install (or bump `prefs.lastSeenVersion` in `%APPDATA%\MAX\state\config.json` to an old
version like `0.3.1`), then open MAX.

**Expect** — the island opens on **Settings**, a toast `Updated to 0.4.0 — Folder scans, snippets and updates.`,
and the release list under "What's new". Reopen the app: **no toast the second time**.

**Do** — expand **Older versions**. **Expect** 0.3.2, 0.3.1, 0.3.0 notes.

---

## 8. Language

**Do** — Settings → Language → **हिन्दी (Hinglish)**.

**Expect** — tab labels become अभी / कोड / आँकड़े / काम / सेटिंग without a reload; the line under the pet
changes too (e.g. `बोलो, क्या करना है`). Commands stay English (`open chrome` still works).

**Do** — switch back to English. **Expect** everything returns, instantly, and the choice survives a
restart.

**If it fails** — labels stay English for a language you added: that key is missing from
`DICTIONARIES` in `src/lib/i18n.ts` — the fallback is English **per key**, by design, so a
half-finished language never shows blanks.

---

## 9. Animations (the only UI work in this release)

Test with **Reduce motion off** first, then on.

| Do | Expect (motion on) | Expect (reduce motion on) |
| --- | --- | --- |
| Click the collapsed island | opens with a slight overshoot, ~0.58s, never a snap | opens instantly, no overshoot |
| Switch tabs | the active pill slides/settles with a spring, text fades in | instant swap |
| Hover over the pet | breathing speeds up (~4.2s → 2.5s), antenna sways faster, halo pulses faster | nothing changes |
| Hold click on the pet | it squashes slightly (0.965) and springs back | no squash |
| Hover/click tab buttons | lifts 1px on hover, presses down on click | no movement |

**If it fails** — anything still moving with Reduce motion on means a rule is missing the
`body[data-motion="reduced"]` guard at the end of `src/styles.css`.

---

## 10. Accessibility

**Do** — press `Tab` repeatedly from the collapsed island.

**Expect** — a visible 2px ring on every focusable control in a sensible order (collapse → tabs →
composer → cards), and you can open/close/switch tabs without a mouse. Esc still closes.

**Do** — run a command with a screen reader on (Narrator is enough).

**Expect** — the toast is announced (`role="status"`, `aria-live="polite"`), the panel reads as a
dialog, and the page has an `h1` (`MAX — desktop companion`).

**If it fails** — no ring at all: `:focus-visible` block at the end of `src/styles.css`.

---

## 11. Regressions — the old stuff must still work

Quick pass, 3 minutes:

- `open notepad` / `open chrome` / `close chrome` (Windows)
- `save note buy milk` → file appears in your notes folder, note shows in the island
- `focus 1` → pill counts down, pet says working, finishing celebrates
- `stats` → all cards, real numbers, green graph (not demo)
- Actions tab → only installed apps, each launches
- Tray → show/hide, always on top, launch at login, Quit
- `Ctrl+Shift+Space` global hotkey opens the palette
- Settings → a bad GitHub handle → plain refusal, not empty numbers

---

## 12. What CI already proved (before you touched it)

- `Verify app`: typecheck, UI build, icons, 99 checks, live smoke of every new route
  (`/api/code/scan`, `/api/code/snippets`, `/api/diagnostics`, `scan`, `check`, `save snippet`).
- `Package Windows`: built the installer, **installed it silently**, asserted `MAX.exe` + `app.asar`
  + `resources\app.asar.unpacked\server\index.mjs`, asserted `latest.yml` exists for the updater,
  then uninstalled.

So if something fails locally, it is most likely environment (missing `npm install`, wrong folder),
not the build.

---

## Known limits (not bugs)

| Thing | Why |
| --- | --- |
| Update check says "only in an installed build" | deliberate: dev builds never phone home |
| SmartScreen warning on install | the installer is unsigned until a certificate is added — see `SIGNING.md` |
| `add app` refuses `.ps1`, `.msi`, `.url` | no shell execution; only real program files |
| Scan stops at 400 files | keeps the island responsive on huge repos |
| Hindi covers the chrome only | commands stay English so `open chrome` keeps working |
| Themes | deferred with the UI pass, as agreed |
