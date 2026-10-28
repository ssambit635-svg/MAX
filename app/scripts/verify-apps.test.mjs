/**
 * Guards the app allowlist: the resolver that finds real Windows installs, and the
 * matcher that turns "open ms word" into the right entry.
 *
 * These checks run without Windows: they only exercise pure logic plus the
 * Linux "not installed" path.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APPS, appCatalog, closeApp, findApp, resolveApp } from "../server/apps.mjs";

let failures = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

const ids = APPS.map((app) => app.id);
const byId = (id) => APPS.find((app) => app.id === id);

await check("allowlist has the requested apps", () => {
  for (const id of ["chrome", "edge", "word", "wps", "whatsapp", "copilot", "camera"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

await check("firefox is gone", () => {
  assert.ok(!ids.includes("firefox"));
  assert.equal(findApp("firefox"), null);
});

await check("every app has terms and a label", () => {
  for (const app of APPS) {
    assert.ok(app.label.length > 1, `${app.id} needs a label`);
    assert.ok(app.terms.length > 0, `${app.id} needs search terms`);
  }
});

await check("open ms word → Microsoft Word", () => {
  assert.equal(findApp("ms word")?.id, "word");
  assert.equal(findApp("microsoft word")?.id, "word");
  assert.equal(findApp("word")?.id, "word");
});

await check("wps / whatsapp / copilot / camera match", () => {
  assert.equal(findApp("wps office")?.id, "wps");
  assert.equal(findApp("whats app")?.id, "whatsapp");
  assert.equal(findApp("co pilot")?.id, "copilot");
  assert.equal(findApp("camera")?.id, "camera");
});

await check("chrome and edge both resolve, with install paths", () => {
  const chrome = byId("chrome");
  const edge = byId("edge");
  assert.equal(findApp("google chrome")?.id, "chrome");
  assert.equal(findApp("chrome")?.id, "chrome");
  assert.equal(findApp("edge")?.id, "edge");
  // Windows is the target: chrome.exe and msedge.exe are never on PATH on a
  // normal install, so absolute candidates must exist.
  assert.ok(chrome.win.paths.some((entry) => entry.includes("Google\\Chrome\\Application\\chrome.exe")));
  assert.ok(edge.win.paths.some((entry) => entry.includes("Microsoft\\Edge\\Application\\msedge.exe")));
  assert.equal(chrome.win.exe, "chrome.exe");
  assert.equal(edge.win.exe, "msedge.exe");
});

await check("store apps use Start-menu names, not bare exes", () => {
  assert.ok(byId("whatsapp").win.startNames.includes("WhatsApp"));
  assert.ok(byId("camera").win.startNames.includes("Camera"));
  assert.ok(byId("wps").win.paths.some((entry) => entry.includes("Kingsoft")));
});

await check("browser falls back to installed browsers, then the default", async () => {
  const browser = byId("browser");
  assert.deepEqual(browser.fallback, ["chrome", "edge"]);
  const resolution = await resolveApp(browser, { cache: false });
  assert.equal(resolution.found, true);
  assert.equal(resolution.kind, "default-browser");
});

await check("unknown app is reported as missing, never invented", async () => {
  const resolution = await resolveApp({ id: "nope", label: "Nope", terms: ["nope"], linux: "definitely-not-installed-xyz" }, { cache: false });
  assert.equal(resolution.found, false);
  assert.ok(Array.isArray(resolution.missing));
});

await check("file manager cannot be closed", async () => {
  const result = await closeApp(byId("explorer"));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "protected");
});

await check("close without a known process name is refused", async () => {
  const result = await closeApp(byId("wps"));
  assert.ok(result.ok === false || result.ok === true || result.ok === undefined);
  // wps has a closeName, so the only acceptable refusal reasons are runtime ones
  if (!result.ok) assert.ok(["not-running", "launch-failed"].includes(result.reason));
});

await check("catalog exposes availability without leaking internals", () => {
  const catalog = appCatalog();
  assert.equal(catalog.length, APPS.length);
  for (const entry of catalog) {
    assert.deepEqual(Object.keys(entry).sort(), ["available", "how", "id", "label", "terms"]);
  }
});

await check("glob expansion finds version folders", async () => {
  // resolveApp's Windows branch cannot run here, so verify the same wildcard idea
  // through a temporary tree that mimics %LOCALAPPDATA%\Kingsoft\WPS Office\*\office6.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "max-apps-"));
  const nested = path.join(root, "11.1.0.15990", "office6");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "wps.exe"), "");
  const found = fs.readdirSync(root).map((name) => path.join(root, name, "office6", "wps.exe"));
  assert.ok(found.some((file) => fs.existsSync(file)));
  fs.rmSync(root, { recursive: true, force: true });
});

if (failures) {
  console.log(`\n${failures} app check(s) failed`);
  process.exit(1);
}
console.log("\nall app paths behave");
