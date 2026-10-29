# MAX 0.4.0 — A to Z test tracker

How this works: I give you a **set** of steps, you test them and reply `checked` / `unchecked`
(plus one line of what you saw). Unchecked ones get fixed, then we retest only those.

Legend: ✅ works · ❌ broken · ⚠️ works but feels wrong (say what feels wrong)

**Progress (0.4.1):** A, B and C are verified — install, tests, island open/close (after the rebuild in
PR #15), tray, hotkey, every pet mood, palette, toasts, real app launching, notes and the focus timer.
Next up: D (stats) → E (code tab) → F (new tools) → G (updates/diagnostics) → H (settings) →
I (motion/a11y) → J (packaging).

| Set | Covers | Steps | Status |
| --- | --- | --- | --- |
| A | Foundation: install, tests, app opens, island, tray | A1–A5 | ✅ checked |
| B | The pet: moods, palette, keyboard, toasts | B1–B5 | ✅ checked |
| C | Real tasks: open/close apps, notes, focus timer | C1–C5 | ✅ checked |
| D | Stats: GitHub, LeetCode, Render, VS Code, bad handles | D1–D6 | ⬜ |
| E | Code tab: review, fix, edit/save, colours, `check`, scan | E1–E7 | ⬜ |
| F | New tools: snippets, custom apps, refusals | F1–F4 | ⬜ |
| G | Updates, diagnostics, What's new, language | G1–G6 | ⬜ |
| H | Every setting actually does something | H1–H6 | ⬜ |
| I | Motion + accessibility | I1–I4 | ⬜ |
| J | Packaging: installer, install test, signature | J1–J3 | ⬜ |

---

## Set A — Foundation

### A1 · Dependencies and test suites
```powershell
cd app
npm install
npm test
```
**Pass when** the last line is `the tools behave` and you counted **99** `PASS` lines, no `FAIL`.
**Watch for** `SKIP esbuild unavailable` — that means tests ran before `npm install`; run again.

### A2 · The app opens
```powershell
npm run desktop
```
**Pass when** the island appears collapsed (a small pill, ~380×88), the pet breathes, and the
terminal shows `[max] island server on …`.
**Watch for** a blank window (server not up) or the terminal closing instantly (Node version < 20).

### A3 · Open and close (rebuilt after the stuck-island bug)
- Click the collapsed island → panel expands, tabs visible
- Press `Esc` → collapses back **fully** — no tab strip left behind, no scrollbar
- Press `Ctrl+Shift+Space` twice → opens, then folds completely
- Drag the island by its top area → it moves, and remembers the position after restart
- Open it 5 times fast, then close it 5 times fast → it always lands either fully open or fully shut

**Pass when** every cycle ends clean. The old build froze mid-way because the window
resized itself behind the renderer's back.

### A4 · Tray
Right-click the tray icon.
**Pass when** you see: Show/Hide, Always on top (ticked), Launch at login, Check for updates…,
Open settings folder, Quit.

### A5 · Global hotkey
Press `Ctrl + Shift + Space` from another app (Notepad).
**Pass when** MAX comes forward with the palette focused.

---

## Set B — The pet and the palette

### B1 · Moods
Run `open notepad` then wait ~2 minutes without touching it.
**Pass when** the pet goes thinking → happy → eventually sleepy, and the line under it follows
(`working on it` → `resting`).

### B2 · Suggestions
Type `op` in the palette.
**Pass when** fuzzy suggestions appear; `↑ ↓` moves, `Tab` completes, `↵` runs.

### B3 · Unknown commands
Type `asdkjhasd`.
**Pass when** MAX says it did not understand plus a short help line — it never pretends.

### B4 · Toasts
Run `stats github`.
**Pass when** a toast slides in at the bottom and disappears by itself after ~4 seconds.

---

## Set C — Real tasks

### C1 · Open apps
`open notepad`, `open chrome`, `open explorer`, `open terminal`.
**Pass when** each opens. Terminal = Windows Terminal if installed, else `cmd`.

### C2 · Close apps
`close chrome`.
**Pass when** Chrome closes gracefully (no force-kill dialog).

### C3 · Notes
`save note buy milk`.
**Pass when** a toast confirms, the note appears in the Now tab, and the `.md` file exists in your
notes folder (Settings shows the path).

### C4 · Focus timer
`focus 1`.
**Pass when** the pill counts down, pet says working, and at zero it celebrates.

### C5 · Quiet behaviour
Leave it alone 2 minutes.
**Pass when** it dims/sleeps rather than staying bright and busy.

---

## Set D — Stats

### D1 · GitHub
`stats` → GitHub card.
**Pass when** it shows `demo: false` style real numbers: your repos, stars, streak, languages,
and the green contribution graph with real days.

### D2 · LeetCode
**Pass when** your handle `sambitswain25` shows real solved counts, or an honest "couldn't reach
LeetCode" — never fake zeros presented as real.

### D3 · Render
**Pass when** either real services appear, or the card says it needs a key.

### D4 · VS Code
**Pass when** recent folders from this machine appear (it reads local storage only).

### D5 · System
**Pass when** CPU / memory / uptime look plausible.

### D6 · Bad handle
Settings → GitHub username → `this-user-does-not-exist-xyz` → Save.
**Pass when** it refuses with a plain reason and **does not** save nonsense.

---

## Set E — Code tab

### E1 · Review
Code tab → it opens with a sample file and lists issues with line numbers.
**Pass when** issues appear without pressing anything.

### E2 · Fix
Press **Fix** on the sample.
**Pass when** only safe fixes apply (`== None` → `is None`, `except:` → `except Exception:`), and
pressing Fix twice changes nothing the second time.

### E3 · Edit, colour, save
Type in the editor.
**Pass when** colours stay in step with the text, `Ctrl+S` saves, unsaved shows `unsaved`.

### E4 · `check <path>`
`check src/lib/i18n.ts` (from `app/`).
**Pass when** the tab opens **with that file**, path filled, score shown.

### E5 · Scan folder button
Code tab → **Scan folder**.
**Pass when** a panel shows score + `N files · X errors · Y warnings` and up to 5 worst files.

### E6 · Scan by keyboard
`scan src`.
**Pass when** toast reads `Scanned 22 files, score 97 — 0 errors, 6 warnings, 9 hints. Worst is
styles.css at 70: !important.`

### E7 · Click a scan row
Click any row in the scan panel.
**Pass when** that file loads into the editor and is reviewed.

---

## Set F — New tools

### F1 · Snippets
```
save snippet debounce: const d = (f, ms) => setTimeout(f, ms)
snippets
snippet debounce     → paste somewhere: the code must be on the clipboard
```
Then Code tab → chip row → click a chip → copied.
Restart MAX → `snippets` still lists it.

### F2 · Duplicate + delete
Save the same name with different code → `Updated snippet…`, still one entry.
`delete snippet debounce` → gone.

### F3 · Custom app
`add app Figma: <real .exe path>` → `open figma` → **Actions** tab shows it → `remove app Figma`.

### F4 · Refusals
`add app X: C:\Windows\System32\notepad.exe` · `add app X: C:\Users\you\notes.txt` ·
`add app notepad: <some .exe>` · `remove app notepad` · `save snippet a/b: x`
**Pass when** each is refused with a plain sentence.

---

## Set G — Updates, diagnostics, notes, language

### G1 · Update check in dev
Settings → **Check for updates**.
**Pass when** it says updates only work in an installed build. (Correct, not a bug.)

### G2 · Update check in the installed build
Install the artifact, then Settings → Check for updates.
**Pass when** either "newest version" or it downloads and the tray grows **Restart to install 0.4.x**.

### G3 · Diagnostics redaction
Settings → **Copy a diagnostics report** → paste into Notepad.
**Pass when** there is no `ghp_…`, no `rnd_…`, no e-mail, and no folder names
(paths look like `«path»/…/file.ts`).

### G4 · The log
Cause a failure (disconnect network → `stats`), then reopen the report.
**Pass when** `recent log:` shows the failure, redacted. File lives in
`%APPDATA%\MAX\state\logs\max.log`.

### G5 · What's new
Set `prefs.lastSeenVersion` to `"0.3.1"` in `%APPDATA%\MAX\state\config.json`, restart.
**Pass when** it opens on Settings + a toast about 0.4.0, and the second restart is silent.

### G6 · Language
Settings → हिन्दी.
**Pass when** tabs become अभी / कोड / आँकड़े / काम / सेटिंग, the pet line changes, and `open chrome`
still works. Switch back → everything returns.

---

## Set H — Every setting must do something

### H1 · Launch at login
Toggle on → restart Windows session (or check Task Manager → Startup) → MAX starts.
Toggle off → it stops.

### H2 · Always on top
Toggle off → another window can cover MAX. Toggle on → MAX stays above. Tray ticks agree.

### H3 · Keep island open
Toggle on → `Esc` no longer collapses it. Toggle off → `Esc` collapses again.

### H4 · Idle sleep
Set `idleSleepSeconds` to `20` in Settings (or config), leave it → pet sleeps sooner.

### H5 · Folders
Change notes folder → `save note test` writes there. Change code folder → `scan` with no path uses it.

### H6 · Quit
Settings → **Quit MAX** → app exits, tray icon disappears, server port closes.

---

## Set I — Motion and accessibility

### I1 · Motion on
Island opens with a spring · tab pill settles · hover the pet → breathing speeds up · hold click →
squash.

### I2 · Reduce motion
Settings → Reduce motion on → all of I1 stops dead. Nothing may still animate.

### I3 · Keyboard only
`Tab` through the island → visible 2px ring on every control, sensible order, tabs switchable.

### I4 · Screen reader
Narrator on → toasts are announced, the panel reads as a dialog, there is an `h1`.

---

## Set J — Packaging

### J1 · CI
The merged `main` run: **Verify app** and **Package Windows** both green.

### J2 · Installer
Download `MAX-0.4.0-win-x64.exe` → install → Start-menu shortcut works → `MAX.exe` runs → the
same app data (settings, snippets) is used.

### J3 · Signature
`Get-AuthenticodeSignature .\MAX-Setup-0.4.0.exe`
**Expected today:** `NotSigned` (no certificate yet). That is a known limit, documented in
`docs/SIGNING.md` — not a failure.

---

## Known limits (expected, not bugs)

- Unsigned installer → SmartScreen warning on first run.
- Dev builds never check for updates.
- Hindi covers the island chrome; commands stay English.
- Scan stops at 400 files / depth 6 / 512 KB per file.
- `add app` accepts only `.exe .bat .cmd .lnk .app .sh` and never system folders.
- Themes and the UI redesign were deferred on purpose.
