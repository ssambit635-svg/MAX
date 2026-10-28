# MAX on Windows — run it, then break it

You downloaded `MAX-windows-x64.zip` from **Actions → Build MAX → Artifacts**. This is what to do
with it and exactly what to try.

---

## 1. Unzip first

Right-click the zip → **Extract All…** → pick a folder (e.g. `Downloads\MAX`).

Do **not** double-click the `.exe` from inside the zip preview — Windows extracts a single file to a
temp folder and MAX's assets come along for the ride in a way that breaks.

After extracting you should see:

| File | What it is |
|---|---|
| `MAX-0.2.1-win-x64.exe` | Installer (~80 MB), per-user, Start-menu shortcut, optional launch at login |
| `MAX-0.2.1-portable.exe` | One file, nothing installed, good for a quick look |
| `latest.yml` | Build metadata, ignore it |

## 2. Run it

**Installer (recommended)**

1. Double-click `MAX-0.2.1-win-x64.exe`.
2. Windows will likely show **“Windows protected your PC”** — MAX is not code-signed yet. Click
   **More info → Run anyway**. (If your antivirus also complains, that is the unsigned Electron
   binary plus NSIS packaging; the source is all in this repo.)
3. Choose a folder if you want (default is fine), install, then launch **MAX** from the Start menu.
4. No admin rights are needed — the installer is per-user.

**Portable**

Double-click `MAX-0.2.1-portable.exe`, same SmartScreen step. It unpacks itself to a temp folder on
each launch; settings and notes still persist in the same place.

## 3. What should happen in the first 10 seconds

- A small **pill** appears near the top-centre of the screen: `◕ MAX │ ● ready … 6 commits · 3/3 live`
- MAX itself is that one bar plus the pet drawn inside it — there is no second window floating over
  your work, and nothing appears in Alt+Tab.
- A **tray icon** appears in the notification area (you may need the `^` overflow arrow).
- There is **no console window and no installer wizard left open**. MAX is a GUI app.

Nothing is spoken. MAX has no voice and no microphone — you type into it.

---

## 4. Test plan — 10 minutes, in order

Tick these off. For anything that does not match “expected”, keep a note; that is what I need back.

### A. The island

| # | Do this | Expected |
|---|---|---|
| A1 | Click the pill | It springs open into a wide glass panel: pet on the left, **Right now / Live activity / Recent saves** on the right |
| A2 | Press `Esc` | Panel folds back into the pill |
| A3 | Click the pill, then the `Stats` / `Actions` / `Settings` tabs | Each view swaps without flicker; the instrument panel stays put |
| A4 | Focus Notepad, press **Ctrl + Shift + Space** | MAX opens over it with the text cursor already in the command box |
| A5 | Right-click the tray icon | Menu: Open MAX, Command palette, Always on top, Launch at login, Open settings folder, Quit MAX |
| A6 | Drag the pill sideways | The window follows the cursor and stays put after restart |
| A7 | Click the pill (no dragging) | It opens — click and drag are both supported |

### B. The pet

| # | Do this | Expected |
|---|---|---|
| B1 | Move your mouse around | Its eyes track the cursor |
| B2 | Single-click it | Happy hop, squash on press, speech bubble |
| B3 | Triple-click it fast | Celebration — confetti, bouncing |
| B4 | Leave it alone for 2 minutes | Eyes close, `z z z`, antenna dims (sleepy) |
| B5 | Drag the island while it is open | MAX moves as one window; position is remembered |
| B6 | Watch it for 30 s | It blinks, breathes, antenna sways — no stutter, no CPU spike (check Task Manager: should be well under 5 %) |

### C. Commands — type these in the palette (`Ctrl+Shift+Space`, then Enter)

| # | Type | Expected |
|---|---|---|
| C1 | `open notepad` | Notepad opens, toast “Opened Notepad.”, mood becomes happy, entry appears in Live activity |
| C2 | `open chrome` | Chrome opens (falls back to your default browser if Chrome is missing) |
| C3 | `open vs code` | VS Code opens. If it fails, VS Code is not on PATH — tell me, I want to fix that detection |
| C4 | `open terminal` | Windows Terminal / PowerShell opens |
| C5 | `open explorer` | File Explorer opens |
| C6 | `close notepad` | Notepad gets a normal close request (unsaved-work prompt stays yours to answer) |
| C7 | `search youtube for lofi` | Browser opens YouTube results for “lofi” |
| C8 | `what time is it` | It answers with your local time |
| C9 | `asdf qwerty` | Honest “I didn’t catch that one” + short help. Error mood: red antenna, sweat drop. **No crash** |
| C10 | Start typing `open ch…` | A suggestion list appears; `↑`/`↓` move, `Tab` completes, `Enter` runs |
| C11 | `help` | Jumps to the Actions tab listing every command |

### D. Notes (your “save this file”)

| # | Do this | Expected |
|---|---|---|
| D1 | Type `new note` | The note composer opens in the Now view |
| D2 | Write two lines, press **Ctrl + Enter** | Toast “Saved as 2026-…-<your-words>.md”, mood celebrates |
| D3 | Open `Documents\MAX notes` in Explorer | The `.md` file is there, with a header and today’s date |
| D4 | Type `save note remember to push the branch` | Saves instantly without opening the composer |
| D5 | Settings → Notes folder → change it → Save, then save another note | New note lands in the new folder |

### E. Focus timer

| # | Do this | Expected |
|---|---|---|
| E1 | Type `focus 1` | Mood switches to **working** (scanline), pill chip counts down, a progress bar appears |
| E2 | Wait ~1 minute | Celebration + “Focus block finished” |
| E3 | Type `focus 25` | Pill chip shows `25m focus` |

### F. Stats and integrations

| # | Do this | Expected |
|---|---|---|
| F1 | Open `Stats` | GitHub / LeetCode / Render cards are marked **DEMO**; **VS Code** and **This machine** show real values (your CPU, RAM, recent workspace folders) |
| F2 | Settings → GitHub → your username → **Connect** | Toast “Saved.”, the GitHub card loses the DEMO badge and shows your real repos / commits |
| F3 | Settings → LeetCode → your handle → **Connect** | Real solved counts, streak and 28-day heatmap |
| F4 | Settings → Render → API key → **Connect** | Only if you have a Render key; otherwise skip |
| F5 | Type `stats github` | Jumps to Stats and pulses the GitHub card for ~3 s |
| F6 | Leave MAX open 2 minutes, reopen Stats | Numbers refresh (60 s cache), CPU bar moves |

### G. Persistence and hard cases

| # | Do this | Expected |
|---|---|---|
| G1 | Tray → **Quit MAX**, then launch again | Panel opens on your last tab, pet back where you left it, integrations still connected |
| G2 | Launch MAX a second time while it is running | It reuses the running instance instead of starting a second one (no duplicate pets) |
| G3 | Sign out and back in (only if you enabled **Launch at login**) | MAX starts quietly, collapsed as a pill |
| G4 | Task Manager → check MAX's memory | Two processes: main + one renderer per window. RAM ~150–250 MB total; ~0 % CPU when idle |

---

## 5. Where your stuff lives

| Thing | Path |
|---|---|
| Settings + integration keys | `%APPDATA%\MAX\state\config.json` |
| Activity log | `%APPDATA%\MAX\state\activity.json` |
| Notes | `Documents\MAX notes` (change it in Settings) |
| Window positions | `%APPDATA%\MAX\window.json` |

Keys are stored locally, in a file only your Windows user can read. No account, no telemetry, no
cloud model. Tray → **Open settings folder** jumps straight there.

## 6. Known limits of this build (not bugs)

- **Unsigned** → SmartScreen warning on first run, and some antivirus heuristics may grumble.
- **No voice, no wake word, no AI chat.** Deliberate: you asked for no voice.
- **Demo badges** stay until you connect GitHub / LeetCode / Render in Settings.
- **It says “Opened …” even if the app turned out not to be installed** — Windows accepts the launch
  command either way. I will make it verify the process next.
- macOS and Linux builds exist but are best-effort; Windows is the target.
- Alt+Tab, the taskbar and the Start menu are intentionally free of MAX's window.

## 7. If something is wrong, send me this

1. The step number from the table above (e.g. “C3 failed”).
2. What you saw — a screenshot is perfect.
3. Whether the Stats cards said **DEMO** or live numbers.
4. For a hard crash: tray → **Open settings folder** and grab anything in there, plus reproduce it
   once from the portable exe so we know it is not the install location.
