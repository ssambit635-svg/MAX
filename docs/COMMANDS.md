# MAX command reference

Everything MAX understands. Nothing else is executed — there is no shell, no model, no remote call
except the integration you connected in Settings.

## Apps

`open <app>` · `launch <app>` · `start <app>` · `run <app>` · `show me <app>`

| Say | Launches |
|---|---|
| notepad / notes | Notepad |
| calculator / calc | Calculator |
| chrome / google chrome | Google Chrome |
| edge / microsoft edge | Microsoft Edge |
| browser | whichever of Chrome / Edge is installed, else your default browser |
| word / ms word / microsoft word | Microsoft Word |
| wps / wps office / wps writer | WPS Office |
| whatsapp / whats app | WhatsApp (desktop or Store app) |
| copilot / co pilot | Copilot (Store app) |
| camera / webcam | Camera |
| vs code / vscode / editor | Visual Studio Code |
| explorer / files / folder | File Explorer |
| terminal / powershell / cmd | Windows Terminal (falls back to cmd) |
| paint | Paint |
| spotify / music | Spotify |
| task manager | Task Manager |
| settings | Windows Settings |

MAX does not guess: every launch checks the real install first — the usual Program Files paths,
`App Paths` in the registry, then Start-menu apps for Store programs (WhatsApp, Copilot, Camera,
WPS). If nothing is found it says so and lists the paths it checked, instead of pretending.
Apps missing from this machine are hidden in **Actions**, and "scan again" re-checks after an install.

`close <app>` · `quit <app>` asks the app to close politely. Unsaved-work dialogs stay yours to answer.
MAX refuses to close the file manager, because it hosts parts of the desktop.

## Web

- `open github` · `open render` · `open leetcode` · `open vercel` · `open gmail` · `open maps`
- `open https://…` opens any link you typed in your default browser
- `search <query>` · `google <query>` — Google
- `search youtube for <query>` · `youtube <query>`
- `search github for <query>` — GitHub search
- `search leetcode` — problemset, with an optional search term

## Notes

- `save note <text>` writes a Markdown file immediately, named from the date and the first words
- `save note "title": <text>` — the quoted part becomes the filename
- `new note` or `save this file` opens the composer (it never invents content for you)
- `⌘/Ctrl + ↵` in the composer saves

Files land in the folder from Settings (`~/Documents/MAX notes` by default) as:

```
2026-10-28-0941-remember-to-push-the-branch.md
# remember to push the branch

_Saved by MAX · 10/28/2026, 9:41 AM_

remember to push the branch
```

## Code

`code` · `lint` · `check code` opens the Code tab.

The editor runs entirely inside the island: no compiler, no local model, no network. It
reads the file, applies a hand-written rule book, and offers two things — a review, and
**safe fixes** you can accept or ignore.

| Column | Meaning |
|---|---|
| error | the file will not run or compile (unbalanced brackets, broken JSON, `gets()`) |
| warning | a real bug risk (`==` on strings in Java, bare `except:`, `unwrap()`, `DELETE` without `WHERE`) |
| hint | style (`var`, trailing spaces, `0px`, unused import) |

Languages: Python, JavaScript, TypeScript, Java, C#, C, C++, Rust, Go, Ruby, Swift, HTML,
CSS, JSON and SQL — about 50 rules in total.

**Fixes only touch what cannot change behaviour:** trailing whitespace, CRLF, final newline,
mixed indentation, `==` → `===` (JavaScript), `var` → `let`, stray `debugger`, `== None` →
`is None`, bare `except:` → `except Exception:`, `0px` → `0`, a missing doctype or `lang`.
A file with a structural error is never rewritten — MAX names the line and asks you to fix it first.

The editor colours code as you type — keywords, strings, comments, numbers, functions, tags,
attributes and CSS properties all get their own colour, in every supported language.

`⌘/Ctrl + Enter` checks, `⌘/Ctrl + S` saves. New files are created in your workspace folder
(`~/Documents/MAX code`); existing files can be opened from anywhere, but system folders,
hidden files and secret files are refused.

### One file, or a whole folder

- `check <path>` · `lint <path>` · `review <path>` — opens that file in the Code tab and lists its
  issues. Plain `check` revisits what is already in the editor.
- `scan` · `scan <path>` · `audit` — walks the folder (depth 6, 400 files max, 512 KB each, skips
  `node_modules`, `.git` and dotfiles), scores it and lists the worst files first. In the Code tab
  the same thing is the **Scan folder** button.
- Clicking a row in the scan list loads that file straight into the editor.

### Snippets

Small fragments you reuse. Stored in `state/snippets.json` (`0600`), never sent anywhere.

- `save snippet debounce: const d = (f, ms) => setTimeout(f, ms)` — saves or replaces by name
- `snippet debounce` · `paste debounce` — puts it on the clipboard
- `snippets` — lists the names
- `delete snippet debounce`

Lookup is exact, then prefix, then anywhere in the name, then anywhere in the code.

## Apps of your own

- `add app Figma: C:\Users\you\AppData\Local\Figma\Figma.exe` — adds a launcher
- `open figma` — works from then on, and it appears in the Actions tab
- `remove app Figma` — forgets it

Built-in apps cannot be removed, only `exe`, `bat`, `cmd`, `lnk`, `app` and `sh` files are
accepted, and anything inside `Windows`, `System32`, `SysWOW64` or `ProgramData` is refused
outright.

## Focus

- `focus` · `focus 25` · `pomodoro 50` — starts a block (1–180 minutes). The pet switches to
  `working`, the pill counts down, and finishing triggers `celebrate`.
- `timer 10` · `remind me in 10`

## Insight

- `stats` — opens Stats and pulses all cards
- `stats github` · `stats leetcode` · `stats render` · `stats vscode` — opens Stats and highlights one card

## Housekeeping

- `help` · `commands` · `what can you do`
- `sleep` · `hide` — the island folds down and the pet naps
- `wake` · `i'm back`
- `what time is it`

## Diagnostics

Settings → **Copy a diagnostics report** builds a redacted text block (version, OS, preferences,
counts, last failures) and copies it. Tokens, e-mail addresses and folder names are stripped first.
Nothing is uploaded. See [`SECURITY.md`](SECURITY.md).

Anything MAX does not recognise gets an honest answer plus the short help line — it never pretends to
have understood.

## Keyboard

| Key | Action |
|---|---|
| `⌘/Ctrl + K` | open the island and focus the palette |
| `⌘/Ctrl + Shift + Space` | global — open the palette from any app (desktop build) |
| `↑` `↓` | move through suggestions |
| `Tab` | complete the highlighted suggestion |
| `↵` | run |
| `Esc` | close the composer, then the island |
