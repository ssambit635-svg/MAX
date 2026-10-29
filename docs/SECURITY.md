# Security and privacy

MAX is a desktop pet that runs commands on your PC. That makes it worth being
explicit about what it can do, what it refuses to do, and what leaves the machine.

## The short version

- **No account, no telemetry, no analytics, no cloud model.** The only network
  requests are the ones your own connected accounts need.
- **Your code never leaves the machine.** Reviews, fixes and folder scans run in a
  local rule engine. There is no model, local or remote.
- **Keys live in one file** (`%APPDATA%\MAX\state\config.json`, `0600`) and are never
  echoed back to the UI — the API returns `connected: true|false`, never the token.
- **The server listens on loopback only** by default and is bound to a random-ish
  port range starting at 47199 in the desktop build.

## Why another page cannot drive the island

Listening on `127.0.0.1` is not privacy: every page in your browser can reach a local
port, and a hostile domain can point its own name at loopback (DNS rebinding). So each
request is checked before any route runs (`server/origin.mjs`):

- the `Host` header must be a loopback name (`127.0.0.1`, `localhost`, `[::1]`) and, when
  it carries a port, that port must be the one MAX is actually serving;
- a request that carries an `Origin` must come from the island itself (or be `null`,
  which is a native client, not a web page);
- anything else gets `403` with a sentence, and nothing is executed.

Widening this is opt-in: `MAX_HOST` changes the bind address and `MAX_TRUSTED_HOSTS`
lists extra hostnames (`*` trusts any). Both are for development; the packaged app
sets neither.

## Folders MAX refuses

Notes, code and scans share one guard (`server/paths.mjs`). A folder the operating
system owns — `Windows`, `System32`, `Program Files`, `/etc`, `/usr`, `/bin`,
`/private`, `/proc`, `/sys`, `Applications`, `Library` — is refused before anything is
written, with a sentence rather than a permission error. Hidden folders, `.ssh`,
`.git`, `node_modules` and secrets files are refused too.

## What MAX can do

| Capability | Boundary |
| --- | --- |
| Launch an app | Only ids from the built-in allowlist, plus launchers you add yourself with `add app`. No shell, no `cmd /c <your text>`. |
| Close an app | Only a process it launched, or one whose name matches the allowlist. |
| Read a file | Only code extensions, under 512 KB, never inside `Windows`, `System32`, `SysWOW64`, `ProgramData`, `node_modules`, `.git`, and never `.env`, `id_rsa`, `.pem`, or dotfiles. |
| Write a file | Only files that already exist and are already readable, or new files inside `~/Documents/MAX code`. |
| Scan a folder | Depth 6, 400 files, 512 KB each, same extension and hidden-file rules. |
| Open a URL | Only the five integration hosts MAX itself uses. |
| Clipboard | Writes snippet text only when you ask for a snippet. Never reads. |

## What leaves the machine

| Destination | When | What is sent |
| --- | --- | --- |
| `api.github.com` | Stats tab, or when you connect GitHub | Your token, and the handle you set |
| `github.com/users/<you>/contributions` | Stats tab | Nothing but the request; the page is public |
| `leetcode.com` | Stats tab | Your public handle |
| `api.render.com` | Stats tab | Your Render key |
| GitHub Releases | Update check (installed build only) | A version query, nothing else |

Everything else is local. There is no third-party crash reporter: failures go to
`%APPDATA%\MAX\state\logs\max.log`, which rotates at 256 KB and stays on disk.

## Diagnostics

Settings → **Copy a diagnostics report** builds a text block on demand. Before it is
shown, these are stripped:

- GitHub, Render and generic query-string tokens → `«github-token»`, `«render-key»`,
  `«redacted»`
- e-mail addresses → `«email»`
- absolute paths → `«path»/…/filename.ts` (the file name is kept, folder names are not)

Nothing is uploaded. You copy it, you decide where it goes.

## Updates

The installed build downloads releases from this repository's GitHub Releases page and
verifies the SHA-512 recorded in `latest.yml`. Updates install when you press
**Restart to install** or quit MAX — never silently in the middle of your work.

Windows builds are unsigned unless a certificate is present (see
[`SIGNING.md`](SIGNING.md)). Unsigned means SmartScreen may warn on first run.

## Report a problem

Open an issue at <https://github.com/ssambit635-svg/MAX/issues> and paste the
diagnostics block. Do not paste tokens; the report already removes them, but check.

## Out of scope

MAX is not a sandbox and is not a security boundary. Anything you can do on this PC,
MAX runs with your rights when you ask it to. Treat `add app` like adding a launcher to
your taskbar: only point it at programs you trust.
