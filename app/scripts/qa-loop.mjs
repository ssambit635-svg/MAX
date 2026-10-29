/**
 * The loop.
 *
 * Watches the parts of MAX that can break it, runs the production gauntlet on
 * every save, and keeps a scoreboard so a regression is obvious the moment it
 * lands:
 *
 *   npm run qa:loop
 *
 * It never stops on a failure — it prints, waits for the next edit, and runs
 * again. Press `r` to rerun by hand, `q` to quit.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const WATCH = ["server", "electron", "src", "scripts"].map((dir) => path.join(APP, dir));

let running = false;
let queued = false;
let runs = 0;
let lastResult = null;

const colour = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const stamp = () => new Date().toLocaleTimeString();

function runGauntlet() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  runs += 1;
  const started = Date.now();
  console.log(`\n${colour(90, `──────── run ${runs} · ${stamp()} ────────`)}`);

  const child = spawn(process.execPath, [path.join(APP, "scripts/verify-production.test.mjs"), "--fast"], {
    cwd: APP,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let failures = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    failures += String(chunk);
  });

  child.on("close", (code) => {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const failing = output.split("\n").filter((line) => line.startsWith("FAIL")).length;
    const passing = output.split("\n").filter((line) => line.startsWith("PASS")).length;

    if (code === 0) {
      console.log(colour(32, `✔ ${passing} checks passed in ${seconds}s`));
      lastResult = { at: Date.now(), code, passing, failing };
    } else {
      // Only the problems, so the fix is on screen instead of scrolled away.
      const lines = output.split("\n");
      const firstBad = lines.findIndex((line) => line.startsWith("FAIL"));
      console.log(lines.slice(firstBad === -1 ? 0 : firstBad).join("\n"));
      if (failures.trim()) console.log(colour(31, failures.trim().split("\n").slice(0, 6).join("\n")));
      console.log(colour(31, `✘ ${failing} failing, ${passing} passing — ${seconds}s`));
      lastResult = { at: Date.now(), code, passing, failing };
    }

    running = false;
    if (queued) {
      queued = false;
      runGauntlet();
    } else {
      console.log(colour(90, "waiting for a change… (r = rerun, q = quit)"));
    }
  });
}

let timer = null;
const schedule = (reason) => {
  if (timer) clearTimeout(timer);
  console.log(colour(90, `↻ ${reason}`));
  // Editors write in bursts; wait for the dust to settle.
  timer = setTimeout(runGauntlet, 350);
};

for (const dir of WATCH) {
  if (!fs.existsSync(dir)) continue;
  fs.watch(dir, { recursive: true }, (_event, file) => {
    if (!file) return;
    if (file.endsWith("~") || file.includes("node_modules") || file.startsWith(".")) return;
    if (!/\.(mjs|ts|tsx|json|css)$/.test(file)) return;
    schedule(`changed: ${file}`);
  });
}

if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (_input, key) => {
    if (key?.name === "q" || (key?.ctrl && key?.name === "c")) process.exit(0);
    if (key?.name === "r") runGauntlet();
  });
}

process.on("SIGINT", () => {
  if (lastResult) console.log(colour(90, `\nlast run: ${lastResult.passing} passing, ${lastResult.failing} failing`));
  process.exit(0);
});

console.log(colour(36, "MAX · production loop"));
console.log(colour(90, `watching ${WATCH.map((dir) => path.relative(APP, dir)).join(", ")}`));
runGauntlet();
