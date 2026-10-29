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
export function computeBounds({ mode, area, current, saved = {}, islandHeight }) {
  const base = mode === "expanded" ? EXPANDED : COLLAPSED;
  // The renderer measures the island, so the frame hugs it instead of leaving a
  // transparent strip that would still eat clicks.
  const wanted = {
    width: base.width,
    height: islandHeight ? Math.max(COLLAPSED.height, Math.round(islandHeight) + 12) : base.height,
  };

  // A display can be smaller than the island (a tiny VM, 800×600, a scaled 720p
  // screen) — shrink to fit rather than hang off the edge.
  const width = Math.max(120, Math.min(wanted.width, area.width - EDGE * 2));
  const height = Math.max(48, Math.min(wanted.height, area.height - EDGE * 2));

  // Remember the centre, not the corner: the island grows in both directions.
  const centre = Number.isFinite(saved.x) ? saved.x : current.x + current.width / 2;
  const x = Math.round(clampToArea(centre - width / 2, area.x + EDGE, area.x + area.width - width - EDGE));
  const y = Math.round(
    clampToArea(Number.isFinite(saved.y) ? saved.y : area.y + EDGE, area.y + EDGE_TOP, area.y + area.height - height - EDGE_TOP),
  );

  return { x, y, width, height };
}

/** True when the saved position is nowhere near this screen any more. */
export function isOffScreen(saved, area) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return false;
  return saved.x < area.x - 40 || saved.x > area.x + area.width + 40 || saved.y < area.y - 40 || saved.y > area.y + area.height + 40;
}
