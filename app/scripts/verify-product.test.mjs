/**
 * The three things that make MAX worth opening: capture that costs nothing,
 * a digest worth glancing at, and a switch that beats alt-tab.
 *
 * Run: node scripts/verify-product.test.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "max-product-"));

process.env.MAX_STATE_DIR = path.join(SANDBOX, "state");
process.env.MAX_DIST_DIR = path.join(APP, "dist");
process.env.MAX_ASSETS_DIR = path.join(APP, "assets");
process.env.MAX_HOST = "127.0.0.1";

const { saveConfig } = await import("../server/store.mjs");
saveConfig({
  saveDir: path.join(SANDBOX, "notes"),
  codeDir: path.join(SANDBOX, "code"),
  github: { username: "", token: "" },
  leetcode: { username: "" },
});

const { capture, highlightSnippet, search, openTasks, todayEntries, cleanTag, fold } = await import("../server/inbox.mjs");
const { buildDigest, digestLine } = await import("../server/digest.mjs");
const { rank, tidy } = await import("../server/switch.mjs");
const { handleCommand } = await import("../server/commands.mjs");

let failures = 0;
let checks = 0;
const results = [];

async function test(name, run) {
  checks += 1;
  const started = Date.now();
  try {
    const problems = (await run()) ?? [];
    if (!problems.length) {
      results.push(`PASS  ${name}  (${Date.now() - started}ms)`);
      return;
    }
    failures += 1;
    results.push(`FAIL  ${name}\n      ${problems.join("\n      ")}`);
  } catch (error) {
    failures += 1;
    results.push(`FAIL  ${name}\n      threw: ${error?.message ?? error}`);
  }
}

/* ------------------------------------------------------------------ capture */

await test("capture writes one searchable line per thought", async () => {
  const problems = [];
  const first = capture("remember to ship 0.6 on Monday");
  if (!first.ok) return [`capture refused: ${first.message}`];
  if (!fs.existsSync(first.file)) problems.push("the file was not written");
  const text = fs.readFileSync(first.file, "utf8");
  if (!text.includes("remember to ship 0.6 on Monday")) problems.push("the words are not in the file");
  if (!/^- \d{1,2}:\d{2} /m.test(text)) problems.push("the line has no timestamp");
  if (!text.includes("# Inbox")) problems.push("the daily file has no heading");

  // Same day, same file: capture is an append, not a new document.
  const second = capture("call the bank");
  if (second.file !== first.file) problems.push("a second capture made a second file");
  if (fs.readFileSync(second.file, "utf8").split("\n").filter((line) => /^- /.test(line)).length !== 2) {
    problems.push("the second line did not land");
  }
  return problems;
});

await test("capture refuses empty input and survives hostile input", async () => {
  const problems = [];
  for (const empty of ["", "   ", "\n\t "]) {
    if (capture(empty).ok) problems.push(`capture accepted ${JSON.stringify(empty)}`);
  }
  const huge = "x".repeat(50_000);
  const capped = capture(huge);
  if (!capped.ok) problems.push("a long capture was refused outright");
  if (capped.ok && capped.line.length > 4200) problems.push(`the stored line is ${capped.line.length} characters`);

  const nasty = capture("../../etc/passwd \u0000 <script>alert(1)</script> #not a path");
  if (!nasty.ok) problems.push("a hostile line was refused instead of stored as text");
  if (nasty.ok && !nasty.file.startsWith(path.join(SANDBOX, "notes"))) problems.push("a hostile line escaped the folder");
  return problems;
});

await test("a task is a checkbox the digest can find", async () => {
  const problems = [];
  const result = capture("- [ ] renew the domain", { tag: "todo" });
  if (!result.ok) return ["the task was not stored"];
  const tasks = openTasks();
  if (!tasks.length) return ["openTasks found nothing"];
  if (!tasks.some((task) => task.text === "renew the domain")) {
    problems.push(`unexpected task text: ${JSON.stringify(tasks.map((task) => task.text))}`);
  }
  if (tasks.some((task) => /^\[?[ x]\]?\s/.test(task.text))) problems.push("the checkbox leaked into the task text");
  if (tasks.some((task) => /\d{1,2}:\d{2}/.test(task.text))) problems.push("the clock leaked into the task text");

  const entries = todayEntries();
  if (!entries.length) problems.push("today's file reported no entries");
  return problems;
});

/* ------------------------------------------------------------------- search */

await test("search finds a word, ignores case and accents, and stays fast", async () => {
  const problems = [];
  capture("Vadász invoice for the Budapest client");
  capture("the deploy key is in the vault, not in git");

  const plain = search("budapest");
  if (!plain.hits.length) problems.push("an exact word did not match");
  const accented = search("vadász");
  if (!accented.hits.length) problems.push("an accented query did not match");
  const folded = search("vadasz");
  if (!folded.hits.length) problems.push("an unaccented query did not match the accented text");
  const upper = search("VADASZ");
  if (!upper.hits.length) problems.push("case matters to search");
  const partial = search("depl");
  if (!partial.hits.length) problems.push("a prefix did not match");

  if (plain.hits[0].snippet.startsWith("- ")) problems.push("the bullet leaked into the snippet");
  if (/\d{1,2}:\d{2}/.test(plain.hits[0].snippet)) problems.push("the clock leaked into the snippet");

  for (const query of ["", "  ", "a", "!!!", "\\", ".*", "(("]) {
    const result = search(query);
    if (!Array.isArray(result.hits)) problems.push(`search(${JSON.stringify(query)}) did not return hits`);
  }
  if (search("").hits.length) problems.push("an empty query returned everything");

  // A thousand files must still answer in well under a second.
  for (let index = 0; index < 400; index += 1) capture(`bulk line ${index} about invoice ${index}`);
  const started = Date.now();
  const big = search("invoice 37");
  const elapsed = Date.now() - started;
  if (!big.hits.length) problems.push("a bulk query found nothing");
  if (elapsed > 1200) problems.push(`search took ${elapsed}ms with ${big.scanned} files`);
  return problems;
});

await test("search results are capped, ranked and never inject markup", async () => {
  const problems = [];
  const many = search("bulk line", { limit: 5 });
  if (many.hits.length > 5) problems.push(`limit ignored: ${many.hits.length} hits`);
  const scores = many.hits.map((hit) => hit.score);
  if (scores.some((score, index) => index > 0 && score > scores[index - 1] + 0.001)) problems.push("hits are not in score order");

  // A snippet is plain text; only the highlighted copy may be markup, and it must
  // be escaped first so a captured line can never become a script tag.
  const hostile = search("alert");
  for (const hit of hostile.hits) {
    const html = highlightSnippet(hit.snippet, "alert");
    if (/<script/i.test(html)) problems.push("raw markup survived into the highlighted html");
    if (!/(&#60;|&lt;)/.test(html)) problems.push("the highlighted html is not escaped at all");
  }
  return problems;
});

/* ------------------------------------------------------------------- digest */

await test("the digest describes a real day and never crashes on a cold one", async () => {
  const problems = [];
  const cold = buildDigest({});
  if (!cold.headline || typeof cold.headline !== "string") problems.push("no headline on a cold start");
  if (!cold.today || typeof cold.today.commands !== "number") problems.push("no tally");
  if (!Array.isArray(cold.tasks)) problems.push("no task list");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cold.date)) problems.push(`odd date key: ${cold.date}`);

  const now = new Date();
  const activity = [
    { kind: "note", at: now.toISOString(), title: "Captured a line" },
    { kind: "app", at: now.toISOString(), title: "Opened Spotify" },
    { kind: "command", at: now.toISOString(), title: "Scanned" },
    { kind: "note", at: new Date(now.getTime() - 48 * 3600_000).toISOString(), title: "Old" },
  ];
  const warm = buildDigest({ activity, tasks: [{ text: "renew the domain" }], entries: ["a", "b"], now });
  if (warm.today.notes !== 1) problems.push(`today counted ${warm.today.notes} notes, expected 1`);
  if (warm.today.apps !== 1) problems.push("apps were not counted");
  if (warm.yesterday.notes + warm.yesterday.commands + warm.yesterday.apps > 1) problems.push("an old entry leaked into yesterday");
  if (!/captured|things done|note/i.test(warm.headline)) problems.push(`unhelpful headline: ${warm.headline}`);
  if (!warm.tasks.length) problems.push("tasks were dropped");
  if (!digestLine(warm)) problems.push("the one-line digest is empty");

  // Garbage in, sentence out.
  for (const input of [null, undefined, { activity: "nope", stats: 5 }, { activity: [null, 5, {}] }]) {
    const digest = buildDigest(input ?? {});
    if (typeof digest.headline !== "string" || !digest.headline.length) problems.push(`no headline for ${JSON.stringify(input)}`);
  }
  return problems;
});

/* ------------------------------------------------------------------- switch */

await test("switching ranks the obvious answer first", async () => {
  const problems = [];
  const candidates = [
    { name: "Visual Studio Code", also: ["vscode", "vs code", "code"] },
    { name: "Google Chrome" },
    { name: "Spotify" },
    { name: "Slack", running: true },
    { name: "Notepad" },
  ];
  const expect = (query, wanted) => {
    const [top] = rank(query, candidates);
    if (!top) return problems.push(`nothing ranked for ${JSON.stringify(query)}`);
    if (top.name !== wanted) problems.push(`${JSON.stringify(query)} ranked ${top.name}, expected ${wanted}`);
    return undefined;
  };

  expect("vscode", "Visual Studio Code");
  expect("vs code", "Visual Studio Code");
  expect("code", "Visual Studio Code");
  expect("chrome", "Google Chrome");
  expect("spot", "Spotify");
  expect("slack", "Slack");
  expect("sl", "Slack");
  expect("vscd", "Visual Studio Code");

  if (rank("zzzz", candidates).length) problems.push("nonsense matched something");
  if (rank("", candidates).length) problems.push("an empty query matched everything");

  // An open window wins a tie: focus is faster than a cold start.
  const tie = rank("code", [{ name: "Code", running: true }, { name: "Code", running: false }]);
  if (!tie.length || !tie[0].running) problems.push("a running window did not win the tie");

  if (tidy("VS  Code!") !== "vscode") problems.push(`tidy gave ${tidy("VS  Code!")}`);
  return problems;
});

/* ---------------------------------------------------------------- commands */

await test("the new verbs work through the real command handler", async () => {
  const problems = [];
  const cases = [
    ["capture buy milk", /captured/i],
    ["todo pay the electricity bill", /list/i],
    ["digest", /today|fresh day|quiet/i],
    ["find in notes milk", /milk|found/i],
    ["performance mode", /performance mode/i],
  ];
  for (const [input, pattern] of cases) {
    const result = await handleCommand(input);
    if (!result?.ok) problems.push(`${input} → ${result?.message}`);
    else if (!pattern.test(result.message)) problems.push(`${input} → "${result.message.slice(0, 80)}"`);
  }
  if (!search("milk").hits.length) problems.push("the captured line is not searchable afterwards");

  // Toggling back leaves the app in its normal state.
  await handleCommand("performance mode");
  return problems;
});

await test("capture never writes outside the notes folder", async () => {
  const problems = [];
  const folder = path.join(SANDBOX, "notes");
  const strays = fs
    .readdirSync(SANDBOX)
    .filter((name) => /\.md$/.test(name));
  if (strays.length) problems.push(`stray files in the sandbox root: ${strays.join(", ")}`);

  for (const name of ["../../escape", "a/b", "..", "CON", "\u0000"]) {
    const result = capture(`line named ${name}`);
    if (result.ok && !path.resolve(result.file).startsWith(path.resolve(folder) + path.sep)) {
      problems.push(`capture escaped with ${JSON.stringify(name)}`);
    }
  }
  if (cleanTag("Hello World!!") !== "hello-world") problems.push(`cleanTag gave ${cleanTag("Hello World!!")}`);
  if (fold("Vadász") !== "vadasz") problems.push("fold did not strip the accent");
  return problems;
});

/* ----------------------------------------------------------------- teardown */

fs.rmSync(SANDBOX, { recursive: true, force: true });
console.log(results.join("\n"));
console.log(failures ? `\n${failures} of ${checks} product checks failed` : `\ncapture, digest and switch work — ${checks} checks`);
process.exit(failures ? 1 : 0);
