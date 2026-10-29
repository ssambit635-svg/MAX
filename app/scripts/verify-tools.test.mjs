/**
 * Guards the tools added after 0.3.2: folder scans, snippets, custom apps and the
 * diagnostics report.
 *
 * These all touch the user's disk, so the test uses a throwaway state directory and
 * a throwaway project folder — nothing here reads or writes real settings.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "max-tools-"));
process.env.MAX_STATE_DIR = path.join(sandbox, "state");

let failures = 0;
const check = async (name, run) => {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const write = (relative, text) => {
  const target = path.join(sandbox, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  return target;
};

const snippets = await import("../server/snippets.mjs");
const project = await import("../server/code/project.mjs");
const diagnostics = await import("../server/diagnostics.mjs");
const apps = await import("../server/apps.mjs");
const { isBlockedPath } = await import("../server/code/files.mjs");

/* --------------------------------------------------------------- snippets */

await check("a snippet round-trips through the store", () => {
  const saved = snippets.saveSnippet("debounce", "const d = (f, ms) => setTimeout(f, ms);");
  assert(saved.ok, saved.message);
  const found = snippets.findSnippet("debou");
  assert(found && found.code.includes("setTimeout"), "prefix lookup failed");
  assert(snippets.findSnippet("setTimeout"), "contains lookup failed");
});

await check("saving the same name replaces instead of duplicating", () => {
  const first = snippets.saveSnippet("repeat", "one");
  assert(first.ok && first.replaced === false, "first save should not replace");
  const second = snippets.saveSnippet("repeat", "two");
  assert(second.ok && second.replaced === true, "second save should replace");
  assert(snippets.snippetIndex().filter((entry) => entry.name === "repeat").length === 1, "duplicate name stored");
});

await check("bad names and empty code are refused", () => {
  assert(!snippets.saveSnippet("", "x").ok, "empty name accepted");
  assert(!snippets.saveSnippet("ok", "   ").ok, "empty code accepted");
  assert(!snippets.saveSnippet("../../escape", "x").ok, "path traversal accepted");
});

await check("deleting a snippet reports what happened", () => {
  assert(snippets.deleteSnippet("repeat").ok, "existing snippet not deleted");
  assert(!snippets.deleteSnippet("repeat").ok, "missing snippet reported as deleted");
});

/* ----------------------------------------------------------- project scan */

write("proj/src/good.ts", "export const add = (a: number, b: number) => a + b;\n");
write("proj/src/loose.js", "var x = 1\nif (x == '1') {\n  debugger\n}\n");
write("proj/src/clean.py", "def greet(name):\n    return f'hi {name}'\n");
write("proj/node_modules/ignored/index.js", "var ignored = true\n");
write("proj/notes.txt", "not code\n");

await check("scan skips node_modules and non-code files", () => {
  const result = project.scanProject(path.join(sandbox, "proj"));
  assert(result.ok, result.message);
  assert(result.summary.files === 3, `expected 3 files, saw ${result.summary.files}`);
  assert(!result.worst.some((entry) => entry.path.includes("node_modules")), "node_modules leaked in");
});

await check("scan ranks the worst file first", () => {
  const result = project.scanProject(path.join(sandbox, "proj"));
  assert(result.worst[0].name === "loose.js", `worst was ${result.worst[0].name}`);
  assert(result.summary.warnings > 0, "expected warnings in the sample");
  assert(result.score >= 0 && result.score <= 100, "score out of range");
});

await check("scan refuses a folder that does not exist", () => {
  const result = project.scanProject(path.join(sandbox, "nope"));
  assert(!result.ok && typeof result.message === "string", "missing folder accepted");
});

await check("scan summary reads like a sentence", () => {
  const message = project.scanMessage(project.scanProject(path.join(sandbox, "proj")));
  assert(/Scanned \d+ files/.test(message), `odd summary: ${message}`);
});

/* ---------------------------------------------------------- custom apps */

await check("a real executable path is accepted", () => {
  const target = write("bin/Fake.exe", "MZ");
  const result = apps.addCustomApp("Fake Editor", target);
  assert(result.ok, result.message);
  const catalog = apps.appCatalog(result.next);
  assert(catalog.some((entry) => entry.id === "custom-fake-editor"), "custom app not in catalog");
  assert(apps.findApp("fake editor", result.next)?.custom === true, "custom app not launchable");
});

await check("system folders and non-programs are refused", () => {
  assert(!apps.addCustomApp("Bad", "C:\\Windows\\System32\\cmd.exe").ok, "system32 accepted");
  assert(!apps.addCustomApp("Bad", write("notes.md", "hi")).ok, "text file accepted");
  assert(!apps.addCustomApp("Bad", path.join(sandbox, "missing.exe")).ok, "missing file accepted");
  assert(!apps.addCustomApp("Notepad", write("bin/notepad.exe", "MZ")).ok, "built-in collision accepted");
  assert(isBlockedPath("C:\\Windows\\System32\\cmd.exe"), "blocked-path helper disagreed");
});

await check("a custom app can be removed again", () => {
  const added = apps.addCustomApp("Fake Editor", write("bin/Fake2.exe", "MZ"));
  assert(added.ok, added.message);
  const removed = apps.removeCustomApp("fake editor", added.next);
  assert(removed.ok, removed.message);
  assert(apps.customApps(removed.next).length === 0, "custom app survived removal");
  assert(!apps.removeCustomApp("notepad", added.next).ok, "built-in removed");
});

/* ------------------------------------------------------- diagnostics */

await check("redaction removes tokens, e-mail and folder paths", () => {
  const text = diagnostics.redact(
    "token ghp_abcdefghijklmnop and rnd_abcdefghijklmn plus a@b.com at C:\\Users\\me\\secret\\app\\main.ts and /home/me/app/x.ts",
  );
  assert(!text.includes("ghp_"), "github token survived");
  assert(!text.includes("rnd_"), "render key survived");
  assert(!text.includes("a@b.com"), "e-mail survived");
  assert(!text.includes("secret"), "folder path survived");
});

await check("the summary carries versions but no secrets", () => {
  diagnostics.logEvent("error", "boom at C:\\Users\\me\\private\\file.ts with ghp_abcdefghijklmnop");
  const summary = diagnostics.diagnosticsSummary({
    config: { github: { username: "someone", token: "ghp_abcdefghijklmnop" }, prefs: { reduceMotion: false } },
  });
  assert(summary.includes("MAX "), "no version line");
  assert(!summary.includes("ghp_"), "token leaked into the summary");
  assert(!summary.includes("private"), "path leaked into the summary");
  assert(diagnostics.readLog(10).length >= 1, "log entry missing");
});

await check("the log survives a clear", () => {
  assert(diagnostics.clearLog(), "clear failed");
  assert(diagnostics.readLog(5).length === 0, "log not empty after clear");
});

/* ------------------------------------------------------------- cleanup */

fs.rmSync(sandbox, { recursive: true, force: true });

console.log(failures ? `\n${failures} tool check(s) failed` : "\nthe tools behave");
process.exit(failures ? 1 : 0);
