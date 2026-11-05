# MAX release acceptance checklist

Automated tests validate the code paths they exercise; they do not replace testing a packaged build on a real desktop. Run this checklist on every supported OS before calling a release ready.

## Test matrix

Record OS version, CPU architecture, build artifact/version, and pass/fail for each platform. At minimum test a clean install and an upgrade path on Windows 10/11, macOS on Apple silicon and Intel where available, and a current supported Linux desktop. If a platform or architecture was not tested, state that plainly in release notes.

## Install, startup, and recovery

- Install from the actual release artifact; verify publisher/signing warnings are documented accurately.
- Launch after install and after reboot. Confirm tray, launch-at-login preference, global shortcut, and window behavior work and can be disabled.
- Test on a small display, non-primary display, 100% and high-DPI scaling, and with the taskbar/dock on each edge. Confirm the island can be recovered if moved or hidden.
- Close/reopen, upgrade from the previous supported release, and uninstall. Confirm user notes/settings are retained on uninstall unless the user explicitly chooses to delete them.
- Simulate a failed update and offline startup. MAX should still open and explain what failed without losing local data.

## Core behavior and privacy

- Try valid, misspelled, empty, and hostile command inputs. Confirm unknown commands do not launch arbitrary processes.
- Test note/snippet create, search, edit/delete, Unicode, restart persistence, and refusal of traversal paths.
- Connect/disconnect integrations, try invalid and expired credentials, rate-limited and offline states, and confirm stale data is clearly identified or removed.
- Confirm tokens are masked in settings, excluded from diagnostics/logs, and removed from displayed integration data after disconnect. Review the actual outbound requests when validating an integration change.
- Scan a disposable project, inspect every suggested change, and run that project's tests/linter. MAX's rule engine is heuristic and is not a compiler, security scanner, or correctness guarantee.

## Record defects

For each failure capture the app version, OS/architecture, reproducible steps, expected/actual result, and a redacted diagnostics report. Never attach credentials, private source code, or unredacted logs. Keep a release blocked for crashes, data loss, unsafe command execution, token leakage, or an updater that installs an invalid build.
