/**
 * Where the window goes, as pure maths.
 *
 * This is the one part of the desktop shell that has to reason about real
 * screens: a 1366×768 laptop with a taskbar, a 4K monitor at 150% scaling, a
 * second display to the left (negative coordinates), and a display that was
 * unplugged since last run. Getting it wrong puts the island half off-screen
 * where it can never be dragged back, so it lives here — importable, and tested
 * — instead of inside main.mjs where only Electron can reach it.
 */

/** Window sizes, including the shadow room around the island. */
export const COLLAPSED = { width: 336, height: 64 };
export const EXPANDED = { width: 868, height: 760 };

/** Breathing room kept between the window and the edge of the screen. */
const EDGE = 8;
const EDGE_TOP = 6;

const clampToArea = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * @param {object} options
 * @param {"collapsed"|"expanded"} options.mode
 * @param {{x:number,y:number,width:number,height:number}} options.area  work area, in screen coordinates
 * @param {{x:number,y:number,width:number,height:number}} options.current current window bounds
 * @param {{x?:number,y?:number}} [options.saved] last position the user chose
 * @param {number} [options.islandHeight] measured height of the open island
 */
/** Anything off disk or over IPC: keep the numbers, throw the rest away. */
const asPoint = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** A finite number, or the fallback. Used for everything that crosses a boundary. */
const asNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** The island's measured height comes over IPC, so it can be anything at all. */
const asHeight = (value) => (Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), 4000) : 0);

export function computeBounds({ mode, area, current, saved, islandHeight }) {
  // `saved` comes from a JSON file a user can edit and a crash can truncate: it
  // may be null, a string, or an array. None of those may stop the window opening.
  const remembered = asPoint(saved);
  const base = mode === "expanded" ? EXPANDED : COLLAPSED;
  // The renderer measures the island, so the frame hugs it instead of leaving a
  // transparent strip that would still eat clicks.
  const measured = asHeight(islandHeight);
  const wanted = {
    width: base.width,
    height: measured ? Math.max(COLLAPSED.height, measured + 12) : base.height,
  };

  // A display that reports nothing (a sleeping monitor, a headless VM) still has
  // to produce a usable window rather than NaN.
  const screenArea = {
    x: asNumber(area?.x, 0),
    y: asNumber(area?.y, 0),
    width: asNumber(area?.width, EXPANDED.width + EDGE * 2),
    height: asNumber(area?.height, EXPANDED.height + EDGE * 2),
  };
  const here = { x: asNumber(current?.x, 0), y: asNumber(current?.y, 0), width: asNumber(current?.width, 0), height: asNumber(current?.height, 0) };

  // A display can be smaller than the island (a tiny VM, 800×600, a scaled 720p
  // screen) — shrink to fit rather than hang off the edge.
  const width = Math.max(120, Math.min(wanted.width, screenArea.width - EDGE * 2));
  const height = Math.max(48, Math.min(wanted.height, screenArea.height - EDGE * 2));

  // Remember the centre, not the corner: the island grows in both directions.
  const centre = Number.isFinite(remembered.x) ? remembered.x : here.x + here.width / 2;
  const x = Math.round(clampToArea(centre - width / 2, screenArea.x + EDGE, screenArea.x + screenArea.width - width - EDGE));
  const y = Math.round(
    clampToArea(
      Number.isFinite(remembered.y) ? remembered.y : screenArea.y + EDGE,
      screenArea.y + EDGE_TOP,
      screenArea.y + screenArea.height - height - EDGE_TOP,
    ),
  );

  return { x, y, width, height };
}

/** True when the saved position is nowhere near this screen any more. */
export function isOffScreen(value, area) {
  const saved = asPoint(value);
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return false;
  return saved.x < area.x - 40 || saved.x > area.x + area.width + 40 || saved.y < area.y - 40 || saved.y > area.y + area.height + 40;
}

/**
 * Whatever `window.json` happens to contain, this returns something placeable.
 * A half-written file (a crash mid-save) parses to `null`, and an older build
 * may have written strings — neither may stop the window from being placed.
 */
export function cleanWindowState(value) {
  const source = asPoint(value);
  const clean = {};
  for (const key of ["x", "y", "width", "height", "islandHeight"]) {
    if (Number.isFinite(source[key])) clean[key] = Math.round(source[key]);
  }
  return clean;
}

/**
 * Dragging must not be able to lose the island. A pet parked entirely past the
 * right edge of a laptop screen looks like a crash, and with always-on-top there
 * is no way to find it again — so a drag keeps at least a comfortable strip of
 * the window inside the work area.
 */
export function clampToScreen(bounds, area, keep = 96) {
  const here = asPoint(bounds);
  const screenArea = {
    x: asNumber(area?.x, 0),
    y: asNumber(area?.y, 0),
    width: asNumber(area?.width, 1440),
    height: asNumber(area?.height, 900),
  };
  const width = Math.max(0, asNumber(here.width, COLLAPSED.width));
  const height = Math.max(0, asNumber(here.height, COLLAPSED.height));
  const visible = Math.max(24, Math.min(keep, width));

  return {
    x: Math.round(clampToArea(asNumber(here.x, 0), screenArea.x - width + visible, screenArea.x + screenArea.width - visible)),
    y: Math.round(clampToArea(asNumber(here.y, 0), screenArea.y - height + 24, screenArea.y + screenArea.height - 24)),
    width,
    height,
  };
}
