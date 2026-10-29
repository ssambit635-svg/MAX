/**
 * The housekeeper.
 *
 * Cheap, mechanical checks that keep MAX from rotting as it grows:
 *
 *   1. no CSS rule whose selector never appears in the markup
 *   2. no export nothing imports
 *   3. every preference in the config is actually used somewhere
 *   4. every allowlisted app is launchable on at least one platform
 *   5. version numbers agree across package.json, the lockfile and the UI
 *   6. no console.log left in the renderer
 *
 * Each check prints what it found, so the fix is obvious.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "dist", "release", ".max", "assets"]);

let failures = 0;
function check(name, run) {
  const problems = run() ?? [];
  if (!problems.length) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}`);
  for (const problem of problems.slice(0, 12)) console.log(`      ${problem}`);
  if (problems.length > 12) console.log(`      … ${problems.length - 12} more`);
}

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const files = walk(APP);
const sourceFiles = files.filter((file) => /\.(ts|tsx|mjs)$/.test(file));
const productFiles = sourceFiles.filter((file) => !file.includes(`${path.sep}scripts${path.sep}`));
const markupFiles = files.filter((file) => /\.(tsx|html)$/.test(file));
const read = (file) => fs.readFileSync(file, "utf8");
const rel = (file) => path.relative(APP, file);

const markup = markupFiles.map(read).join("\n");
const sources = new Map(sourceFiles.map((file) => [file, read(file)]));
const productSources = new Map(productFiles.map((file) => [file, read(file)]));

/* ---------------------------------------------------------------- 1. CSS -- */

check("every CSS rule is used by the markup", () => {
  const css = read(path.join(APP, "src/styles.css"));
  const blocks = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push(css.slice(start, index + 1));
        start = index + 1;
      }
    }
  }
  const problems = [];
  for (const block of blocks) {
    const selector = block.split("{")[0].trim();
    if (!selector || selector.startsWith("@") || selector.startsWith("/*")) continue;
    const classes = [...new Set([...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]))];
    if (!classes.length) continue;
    // `tok-*` classes are produced by src/lib/highlight.ts at runtime, not written in JSX.
    if (classes.every((name) => name.startsWith("tok-"))) continue;
    const live = classes.filter((name) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(markup));
    if (!live.length) problems.push(`unused: ${selector.replace(/\s+/g, " ").slice(0, 70)}`);
  }
  return problems;
});

/* ------------------------------------------------------------ 2. exports -- */

/** These are entry points or public API; nothing imports them by name. */
const ENTRY_EXPORTS = new Set([
  "server/index.mjs:startServer",
  "server/index.mjs:createServer",
  "src/main.tsx:",
  "src/App.tsx:default",
]);

check("every export is imported somewhere", () => {
  const problems = [];
  for (const [file, text] of productSources) {
    const names = [
      ...[...text.matchAll(/export (?:async )?(?:function|const|class|let) (\w+)/g)].map((match) => match[1]),
      ...[...text.matchAll(/export \{([^}]+)\}/g)].flatMap((match) =>
        match[1].split(",").map((entry) => entry.trim().split(/\s+as\s+/).pop()),
      ),
    ].filter(Boolean);

    for (const name of names) {
      if (ENTRY_EXPORTS.has(`${rel(file)}:${name}`)) continue;
      let externalUses = 0;
      for (const [other, otherText] of sources) {
        if (other === file) continue;
        externalUses += (otherText.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      }
      if (externalUses === 0) problems.push(`${rel(file)} exports ${name}, but nothing imports it`);
    }
  }
  return problems;
});

/* -------------------------------------------------------------- 3. prefs -- */

check("every preference actually does something", () => {
  const store = sources.get(path.join(APP, "server/store.mjs"));
  const defaults = store.slice(store.indexOf("prefs: {"), store.indexOf("},", store.indexOf("prefs: {")));
  const names = [...defaults.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);

  const consumers = [path.join(APP, "src/App.tsx"), path.join(APP, "src/components/SettingsView.tsx"), path.join(APP, "electron/main.mjs")];
  const haystack = consumers.map((file) => (fs.existsSync(file) ? read(file) : "")).join("\n");

  return names
    .filter((name) => !new RegExp(`\\b${name}\\b`).test(haystack))
    .map((name) => `pref "${name}" is saved but nothing reads it`);
});

/* --------------------------------------------------------------- 4. apps -- */

check("every allowlisted app can be launched on some platform", async () => {
  const { APPS } = await import("../server/apps.mjs");
  const problems = [];
  for (const app of APPS) {
    const hasWin = Boolean(app.win?.paths || app.win?.exe || app.win?.protocol || app.win?.defaultBrowser);
    const hasMac = Boolean(app.mac);
    const hasLinux = Boolean(app.linux);
    if (!hasWin && !hasMac && !hasLinux) problems.push(`${app.id} has no launch target at all`);
    if (!app.label || !app.terms?.length) problems.push(`${app.id} is missing a label or search terms`);
  }
  return problems;
});

/* ------------------------------------------------------------ 5. version -- */

check("version numbers agree", () => {
  const pkg = JSON.parse(read(path.join(APP, "package.json")));
  const lock = JSON.parse(read(path.join(APP, "package-lock.json")));
  const problems = [];
  if (lock.version !== pkg.version) problems.push(`package-lock version ${lock.version} ≠ package.json ${pkg.version}`);
  const lockedRoot = lock.packages?.[""]?.version;
  if (lockedRoot !== pkg.version) problems.push(`lockfile root version ${lockedRoot} ≠ ${pkg.version}`);
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) problems.push(`version "${pkg.version}" is not semver`);
  return problems;
});

/* ------------------------------------------------------------ 6. console -- */

check("no console output in the renderer", () => {
  const problems = [];
  for (const file of productFiles.filter((entry) => entry.includes(`${path.sep}src${path.sep}`))) {
    read(file)
      .split("\n")
      .forEach((line, index) => {
        if (/console\.(log|debug|info)\(/.test(line)) problems.push(`${rel(file)}:${index + 1} logs to the console`);
      });
  }
  return problems;
});

/* ------------------------------------------------------------ 7. routes -- */

check("every API route the UI calls exists on the server", () => {
  const api = read(path.join(APP, "src/lib/api.ts"));
  const server = read(path.join(APP, "server/index.mjs"));
  const routes = [...new Set([...api.matchAll(/"(\/api\/[a-z/-]+)/g)].map((match) => match[1]))];
  const problems = [];
  for (const route of routes) {
    const [pathname] = route.split("?");
    if (!server.includes(`"${pathname}`) && !server.includes(`GET ${pathname}`) && !server.includes(`POST ${pathname}`)) {
      problems.push(`the UI calls ${pathname}, but no route handles it`);
    }
  }
  return problems;
});

if (failures) {
  console.log(`\n${failures} housekeeping check(s) failed`);
  process.exit(1);
}
console.log("\nthe codebase is tidy");
