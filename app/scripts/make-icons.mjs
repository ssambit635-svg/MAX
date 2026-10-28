/**
 * Builds every icon MAX ships from one source of truth: the SVG pet component.
 *
 *   node scripts/make-icons.mjs
 *
 * Outputs:
 *   build/icon.ico        multi-size Windows icon (16 → 256)
 *   build/icon.icns       macOS icon (16 → 1024)
 *   build/icons/*.png     Linux icon set
 *   assets/icon.png       512 px app icon (also served as the favicon)
 *   assets/tray.png       64 px tray icon
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { Resvg } from "@resvg/resvg-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(ROOT, "node_modules", ".cache", "max-icons");

fs.mkdirSync(TMP, { recursive: true });

/* ---------------------------------------------------------------- artwork */

const entry = path.join(TMP, "icon-entry.tsx");
fs.writeFileSync(
  entry,
  `import { renderToStaticMarkup } from "react-dom/server";
import { Pet } from ${JSON.stringify(path.join(ROOT, "src", "components", "Pet.tsx"))};

const inner = renderToStaticMarkup(<Pet mood="happy" size={200} />)
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\\/svg>$/, "");

const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="iconBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#16304a"/>
      <stop offset="52%" stop-color="#0a1725"/>
      <stop offset="100%" stop-color="#050b13"/>
    </linearGradient>
    <radialGradient id="iconGlow" cx="50%" cy="14%" r="66%">
      <stop offset="0%" stop-color="#6fe7ff" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#6fe7ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#iconBg)"/>
  <rect width="512" height="512" rx="116" fill="url(#iconGlow)"/>
  <rect x="7" y="7" width="498" height="498" rx="110" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="3"/>
  <g transform="translate(41 44) scale(2.15)">\${inner}</g>
</svg>\`;

process.stdout.write(svg);`,
);

const outfile = path.join(TMP, "icon-entry.cjs");
await esbuild({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  outfile,
  logLevel: "error",
});

const { execFileSync } = await import("node:child_process");
const rawSvg = execFileSync(process.execPath, [outfile], { encoding: "utf8" });

// Static styles for the pet: the component's classes are meaningless without CSS,
// so pull the pet rules + the expression keyframes out of the stylesheet.
const css = fs.readFileSync(path.join(ROOT, "src", "styles.css"), "utf8");
const rules = [];
for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = match[1].trim();
  if (selector.startsWith("@keyframes")) continue;
  if (selector.includes(".pet")) rules.push(`${selector}{${match[2]}}`);
}
const wanted = new Set([
  "pet-breathe", "pet-hop", "pet-bounce", "pet-sleep", "pet-work", "pet-tilt", "pet-listen",
  "pet-shake", "antenna-sway", "halo-pulse", "blink", "zzz", "think-dot", "twinkle",
  "confetti", "ring-out", "sweat", "orbit", "scan",
]);
const keyframes = [...css.matchAll(/@keyframes\s+([a-zA-Z-]+)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g)]
  .filter((match) => wanted.has(match[1]))
  .map((match) => match[0]);

const svg = rawSvg.replace(
  /(<rect width="512" height="512" rx="116" fill="url\(#iconBg\)"\s*\/>)/,
  `$1<style>${[...rules, ...keyframes].join("\n")}</style>`,
);

/* ------------------------------------------------------------- rasterize */

const png = (size) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: false } })
    .render()
    .asPng();

/* ------------------------------------------------------------------- ico */

function writeIco(sizes, target) {
  const images = sizes.map((size) => ({ size, data: png(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    entries.push(entry);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
  console.log(`ico   ${path.relative(ROOT, target)} (${sizes.join(", ")})`);
}

/* ------------------------------------------------------------------ icns */

function writeIcns(target) {
  const chunks = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ].map(([type, size]) => {
    const data = png(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([head, data]);
  });

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + body.length, 4);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.concat([header, body]));
  console.log(`icns  ${path.relative(ROOT, target)}`);
}

/* ------------------------------------------------------------------- run */

writeIco([16, 24, 32, 48, 64, 128, 256], path.join(ROOT, "build", "icon.ico"));
writeIcns(path.join(ROOT, "build", "icon.icns"));

const linuxSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
fs.mkdirSync(path.join(ROOT, "build", "icons"), { recursive: true });
for (const size of linuxSizes) {
  fs.writeFileSync(path.join(ROOT, "build", "icons", `${size}x${size}.png`), png(size));
}
console.log("png   build/icons/*.png");

fs.mkdirSync(path.join(ROOT, "assets"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "assets", "icon.png"), png(512));
fs.writeFileSync(path.join(ROOT, "assets", "tray.png"), png(64));
console.log("png   assets/icon.png, assets/tray.png");
