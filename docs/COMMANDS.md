# MAX command reference

Everything MAX understands. Nothing else is executed — there is no shell, no model, no remote call
except the integration you connected in Settings.

## Apps

`open <app>` · `launch <app>` · `start <app>` · `run <app>` · `show me <app>`

| Say | Launches |
|---|---|
| notepad / notes | Notepad (Windows) · TextEdit (macOS) · gedit (Linux) |
| calculator / calc | Calculator |
| chrome / browser | Google Chrome |
| edge | Microsoft Edge |
| firefox | Firefox |
| vs code / vscode / editor | Visual Studio Code |
| explorer / files / finder | File Explorer / Finder |
| terminal / powershell | Windows Terminal / Terminal |
| paint | Paint / Preview |
| spotify / music | Spotify |
| task manager | Task Manager / Activity Monitor |
| settings | Windows Settings / System Settings |

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
