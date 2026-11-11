# MAX — Practical QA Test Plan (Windows-first)

A step-by-step manual acceptance plan for testing a downloaded MAX build. Run the phases in order, mark each result, and record failures instead of guessing. MAX is a deterministic local desktop companion, **not an AI assistant**; AI below is an optional helper for organizing test results, not part of MAX.

> **Safety first:** use a non-critical Windows account or VM if possible. Do not paste API keys, private source code, real agent prompts, customer data, or personal notes into an external AI. Never approve tool permissions through MAX: that feature is not in scope. MAX must not inject keystrokes into a running terminal.
>
> **Agent-hook caution:** lifecycle-hook setup has not yet been validated against every real provider/version. Do not install hooks into your everyday agent profile during this acceptance run. Hook setup/removal tests are marked **isolated-only** and require a throwaway profile/config copy. Direct reply submission should only be tested for providers MAX currently marks as supported; use a disposable session.

---

## Test run record

Copy this block into a separate notes file before starting.

```text
Tester:
Date/time + timezone:
MAX version / downloaded filename:
Windows version / build:
Device type (VM / spare PC / daily PC):
Install type (installer / portable):
Display scaling / resolution:
Connected integrations (names only; never paste secrets):
Result: PASS / PASS WITH ISSUES / FAIL / BLOCKED
```

For every failed step, record: **test ID, exact steps, expected result, actual result, screenshot if useful, and whether it reproduces after restarting MAX**. Redact usernames, paths, tokens, repository names, and agent text before sharing logs/screenshots.

### Result key

- `[ ] PASS` — observed the expected result.
- `[ ] FAIL` — did not match; record exact reproduction steps.
- `[ ] BLOCKED` — could not test (say why); do not count as a pass.
- `N/A` — feature does not apply to this machine/build.

---

# Phase 0 — Prepare safely

1. Download MAX from the release or CI artifact link supplied by the project maintainer. Check that the filename and version are the intended build. Do not run an installer copied from an unknown source.
2. Close any older MAX instance before installing. If testing upgrades, first note the old version and back up important MAX data.
3. Keep a small **throwaway test folder** with a few text/code files, including one harmless intentionally malformed file. Do not point scan/review tools at your whole home folder.
4. If using real agent CLIs, create a disposable test project/session with no secrets and no consequential tools. Otherwise skip the provider-specific session tests.
5. Optional baseline: run MAX on a second Windows account or VM to test first-run behavior without changing your normal profile.

**Pass when:** tester has the build identity, a safe scratch folder, and knows where MAX saves its notes/config. Do not proceed with a build whose origin is uncertain.

# Phase 1 — Download, install, launch, and remove

## 1.1 Installer path

1. Run the downloaded Windows installer. If Windows SmartScreen appears, verify the publisher/file source first. An unsigned build may show a warning; never bypass a warning for a file you cannot verify.
2. Choose a per-user install location (or the intended location), finish setup, and launch MAX from the Start menu/desktop shortcut.
3. Confirm MAX opens without a setup crash, blank screen, repeated error dialog, or unexpected second window.
4. Close and relaunch MAX. Verify it launches again and your normal preferences remain.

**Expected:** one usable MAX island/window, app is responsive, and the installed build can start the local service. Record installer path and any warning. A package being produced is not enough: the installed app must launch.

## 1.2 Portable path (if provided)

1. Put the portable executable in a temporary folder you control.
2. Launch it, use one basic feature (open the panel or run `help`), close MAX normally, and relaunch it.
3. Check whether data persistence matches the documented portable behavior; do not assume the portable build is isolated from installer data.

## 1.3 Uninstall check (optional; do this only after the rest)

1. Use Windows **Settings → Apps → Installed apps** to uninstall MAX.
2. Confirm the app is removed and no MAX process remains after a short wait.
3. Verify whether user data is intentionally retained. Do not delete the MAX data folder unless you have copied anything you want to keep.

**Fail if:** install silently fails, MAX.exe is missing, the app cannot relaunch, or uninstall leaves an unexplained running process. Capture the exact Windows message and build filename.

# Phase 2 — First launch and basic shell

1. Start MAX and inspect the collapsed island/pill. Wait 30 seconds.
2. Click it to expand, click again or use the collapse control to fold it. Try `Ctrl+K` to open the command palette and `Esc` to close (unless the panel is pinned open).
3. Drag the island to a different safe place on screen. Minimize/restore or restart MAX; check that it stays visible and on-screen.
4. Open Settings. Toggle **Always on top**, **Launch at login**, and **Reduce motion** one at a time; verify each setting's described behavior, then restore your preferred values.
5. Use the tray menu if present: show/hide, always-on-top, launch-at-login, and quit. Relaunch after quit.
6. Resize display scaling/resolution if convenient, or move the window between monitors. Check that it does not become clipped or stranded off-screen.

**Expected:** animation is smooth enough to use; app remains interactive; Escape and shortcuts behave sensibly; tray and Settings do not contradict one another. A reduced-motion preference should materially reduce motion.

# Phase 3 — Command palette and daily workflow

Test each command separately and check both the toast/result and the real-world effect.

1. Open the palette, type `open notepad`, use the arrow keys and Tab completion, then Enter. Verify Notepad opens. Close it normally.
2. Test a web command such as `search github for vite`. Verify the expected trusted page opens in the browser. Do not test with an unexpected URL or try to bypass link restrictions.
3. Run `help`; compare the listed actions with what the app actually supports.
4. Run one valid command twice (for example `open notepad`). Reopen the palette and verify successful recent commands appear if recent-history suggestions are enabled. Clear/restart MAX and confirm history behavior is sensible and local.
5. Enter an unknown command, malformed text, very long input, and shell-looking text such as `open notepad & calc`. MAX should respond safely; it must not execute arbitrary shell syntax or launch an unintended program.
6. Use keyboard-only navigation: Tab through controls, arrows through suggestions, Enter to select, Escape to close. Check visible focus and that selection is not accidentally submitted twice.

**Expected:** only known, allowlisted actions occur; suggestions are relevant; unknown requests produce a clear response rather than a crash. MAX's command experience is deterministic and does not generate novel answers.

# Phase 4 — Project shortcuts

1. In the **Now** view, use **Choose folder…** and select the throwaway project folder.
2. Give it a recognizable name and save the shortcut.
3. Confirm the name and selected folder appear in the list. Save a second folder if available.
4. Click the shortcut in the desktop build. Confirm Windows opens that exact folder in the file manager.
5. Rename the same folder entry by saving the same path under a new name; verify there is not an unwanted duplicate. Remove a shortcut and verify it disappears.
6. Restart MAX and verify saved shortcuts persist in the same browser/app profile. Try a shortcut whose folder has been moved or removed; MAX should show a clear failure, not hang.
7. If testing browser preview instead of desktop, confirm the folder-picker limitation is explained and the available fallback copies the path. Do not treat browser preview as proof of desktop IPC behavior.

**Expected/known limit:** shortcuts store a folder name and path locally and open the folder in the file manager. They do **not** yet launch a complete editor + terminal + dev-server workspace. Paths are personal data; redact them in reports.

# Phase 5 — Notes, tasks, focus, and “what was I doing?”

1. Save a harmless note (example: `save note QA scratch note`) and verify it appears in MAX's recent saves and as a Markdown file in the configured notes folder.
2. Restart MAX and confirm the saved note remains. Search notes using a known word; confirm unrelated files are not modified.
3. Add a harmless capture/task using the supported command shown by `help` or suggestions. Mark the task complete if the UI offers it. Confirm the digest describes actual saved activity, not fabricated events.
4. Start a short focus block (for example `focus 1`). Confirm the countdown/progress changes and the UI remains responsive. Wait for completion or stop/restart according to the available controls.
5. Start a timer (for example `timer 1`) and verify it fires once at approximately the requested time. Check it does not repeat or survive restart in a misleading state.
6. Review Right Now, recent activity, and recent saves. Confirm timestamps and status are plausible; when no integration is connected, demo values must be identified as demo.
7. Save empty/whitespace-only notes and hostile-looking text; confirm MAX rejects or safely stores content without escaping its notes folder.

**Expected:** user-created data stays in the configured local locations, and the “return to work” view reports only information MAX actually has.

# Phase 6 — Code utilities and app actions

Use only the throwaway test folder.

1. Open the **Code** tab and load a harmless sample file. Check language detection, line numbers, highlighting, and readable findings.
2. Test a file with one obvious issue and another clean file. Confirm findings point to the right file/line and are described as heuristic suggestions—not compiler/security guarantees.
3. Use **Fix** only on a copied sample. Compare the before/after. Verify MAX does not make risky semantic changes automatically and refuses a structurally broken file when appropriate.
4. Scan the throwaway folder. Confirm it lists a bounded set of files and does not unexpectedly walk into `.git`, `node_modules`, hidden folders, or unrelated directories.
5. Save a harmless code snippet, copy it, paste it into Notepad, update it under the same name, then delete it. Confirm the clipboard and list match each action.
6. Open **Actions** and run a few apps that are actually installed. Try the refresh/check control. A missing optional app should be reported as unavailable rather than invented/launched from a guessed path.
7. If adding a custom app, use a benign program you trust. Confirm it appears, opens, and can be removed. Do not register scripts or unknown executables.

**Expected:** file boundaries are respected; MAX never silently runs arbitrary commands; heuristic code feedback is not mistaken for a full compiler or security audit.

# Phase 7 — Integrations and local privacy

Do this only if you intentionally connect an integration. Use least-privilege/read-only credentials and never include a credential in screenshots, AI prompts, or bug reports.

1. With no integrations configured, inspect Stats. Confirm demo/placeholder figures are clearly presented as such.
2. Optionally connect one integration using its Settings instructions. Confirm only that integration's card changes to real status.
3. Disconnect it. Confirm the UI stops presenting cached values as current real data.
4. Disconnect the network and refresh a stats view. MAX should remain usable and give a bounded, understandable error; restore the network afterward.
5. Generate/copy a diagnostics report. Inspect it locally for API keys, email addresses, usernames, host names, and full paths. If any secret or personal information is visible, do not share the report—record a redacted bug instead.
6. Confirm notes, project shortcuts, recent commands, and agent snippets remain on the test device/profile. Do not infer “local-only” merely from the UI label; report any unexpected outbound connection for review.

# Phase 8 — Agent sessions (optional; isolated testing only)

**Skip this phase if you do not have a disposable profile and safe, non-sensitive agent session. Do not test against a live production project.** MAX does not approve tool/permission requests and must not control a terminal by keystroke injection.

1. Check the Agents view with no providers installed/configured. It should explain unavailable providers without breaking the rest of MAX.
2. For hook preview/install/removal, use a throwaway Windows profile or copied config fixture. Back up the fixture yourself first. Review the exact before/after preview and backup location. Abort if the path, event schema, or change is unexpected. Never point the test at your everyday provider settings until provider-specific behavior is verified.
3. If hooks are enabled in the disposable profile, emit a harmless start/stop lifecycle event. Confirm MAX shows only bounded session metadata and that the local session list clears when asked. Restart MAX and confirm in-memory snippets are not unexpectedly retained.
4. Test a question/reply preview using a disposable, non-sensitive question. Read the exact message, session, and action. Cancel once; confirm nothing is sent. Create a fresh preview, confirm it once, and verify the provider response in that same disposable session.
5. Try a stale/expired session preview and a second confirmation attempt. MAX should refuse and require a fresh review.
6. For providers marked copy-only/unavailable, verify the copy/open fallback and manually paste only into the disposable session. Never assume a green UI state proves provider support.
7. If a permission/tool approval appears, MAX must not auto-approve it. Treat any automatic approval or terminal keystroke as a security defect and stop testing.

**Known caution:** hook setup schemas and behavior still need real-provider/version validation. A mocked test or settings preview alone is not proof that a real CLI will emit the event correctly.

# Phase 9 — Reliability, accessibility, and recovery

1. Leave MAX open while switching tabs repeatedly and running two ordinary actions in sequence. Confirm it does not freeze, lose the panel, or duplicate actions.
2. Restart MAX during idle, after saving a note, and after changing a preference. Confirm expected persistent data remains and transient status is not shown as current when it is stale.
3. Simulate an offline integration failure. Confirm MAX stays open and the error is understandable; reconnect and retry.
4. Enable Reduce motion. Navigate the UI and verify the preference survives restart.
5. Use Windows Narrator or another screen reader for the palette, tabs, primary buttons, and toast messages. Check control names and focus order. Note any unlabeled control.
6. Test at higher Windows display scaling and a narrow window/small display if possible. Confirm critical controls remain reachable and text does not overlap.
7. If the app crashes, relaunch it. Check that the failure did not corrupt settings or delete notes. Never “fix” a failure by deleting user data before backing it up.

# Phase 10 — Optional AI-assisted QA

AI can help sort observations, but it cannot prove the app works and MAX itself does not call an AI model. Only use an approved AI tool with **sanitized** information. Do not upload full logs, screenshots with personal details, source code, or config files containing secrets.

## Safe workflow

1. Complete the manual test and write down exact steps/result first.
2. Replace usernames, machine names, folder paths, repository names, access tokens, emails, and agent text with placeholders such as `[USER]`, `[PATH]`, `[TOKEN REDACTED]`.
3. Give the AI only the sanitized test ID, expected behavior, actual behavior, and a short error excerpt.
4. Ask it to classify and suggest diagnostics, not to declare a pass or edit production settings.
5. Verify every suggestion manually. Do not run generated shell commands without understanding and checking them.

## Copyable prompt for a sanitized failure

```text
You are helping triage a manual QA failure for MAX, a local Windows desktop companion.
Do not assume the app is correct. Do not ask for secrets or private source code.

Test ID:
Build/version:
Expected:
Actual:
Steps to reproduce:
Sanitized error excerpt:
Did it reproduce after restart? yes/no/not tested

Please return:
1) likely category (UI, packaging, data, integration, security, environment, unknown),
2) the smallest safe next diagnostic step,
3) what evidence would confirm or disprove the hypothesis,
4) severity suggestion (Blocker / High / Medium / Low) and why.
Do not claim the test passed and do not suggest disabling security protections.
```

# Phase 11 — Final QA decision

Use this release decision, not a gut feeling:

- **PASS:** installation and launch work; core palette, notes, project folder shortcut, utility, privacy, and recovery tests pass; no unresolved high-severity defect.
- **PASS WITH ISSUES:** core flow works, but one or more non-blocking defects are recorded with workarounds. List every issue.
- **FAIL / DO NOT RECOMMEND:** installer/app cannot launch, user data is lost/corrupted, an unsafe action happens, a secret leaks, a hook modifies unexpected settings, or MAX sends/approves something without explicit confirmation.
- **BLOCKED:** test environment or required integration/provider was unavailable. Keep blocked tests out of the pass count.

### Defect report template

```text
Title:
Severity: Blocker / High / Medium / Low
Build + Windows version:
Test ID:
Preconditions:
Steps (numbered):
Expected:
Actual:
Reproducible after restart? yes/no
Scope: installer / shell / project shortcut / palette / notes / code / integration / agent / other
Evidence attached? (redacted):
Workaround:
```

### Completion checklist

- [ ] Installer or portable build starts and can be reopened.
- [ ] Palette and allowlisted app actions work; arbitrary shell-looking input is inert.
- [ ] Project shortcut selects, saves, opens, removes, and persists the expected folder path.
- [ ] Notes/focus/recent activity behave as expected and stay within intended local storage.
- [ ] Code utilities and app shelf behave safely on a scratch folder/machine.
- [ ] Demo/real integration state is distinguishable; diagnostic output is reviewed for secrets.
- [ ] Agent hook tests were skipped or run only in a disposable profile; no permission approval/keystroke injection occurred.
- [ ] Accessibility/recovery checks are recorded.
- [ ] All failures and blocked tests are documented; no blocker/high security or data-loss issue remains.
