import { useCallback, useRef } from "react";
import { shellBridge } from "./shell";

/**
 * Clickable *and* draggable.
 *
 * `-webkit-app-region: drag` makes an element a window drag handle but Electron then
 * eats every mouse event on it — which is why the island looked alive but never opened
 * when clicked. So MAX drags the window manually over IPC and decides for itself whether
 * the gesture was a click (no movement) or a drag (more than a few pixels).
 */
export function useWindowDrag() {
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; active: boolean } | null>(null);
  const justDragged = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const bridge = shellBridge();
    if (!bridge) return; // browser preview: no window to move

    gesture.current = { startX: event.screenX, startY: event.screenY, moved: false, active: true };
    justDragged.current = false;
    // Capture on the element so the drag survives fast pointer movement.
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    bridge.dragBegin(event.screenX, event.screenY);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const current = gesture.current;
    if (!current?.active) return;
    if (!current.moved && (Math.abs(event.screenX - current.startX) > 3 || Math.abs(event.screenY - current.startY) > 3)) {
      current.moved = true;
    }
    if (current.moved) shellBridge()?.dragMove(event.screenX, event.screenY);
  }, []);

  const endGesture = useCallback((event: React.PointerEvent) => {
    const current = gesture.current;
    if (!current?.active) return;
    current.active = false;
    justDragged.current = current.moved;
    gesture.current = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
    shellBridge()?.dragEnd();
  }, []);

  /** True once, if the last pointer gesture actually moved the window. */
  const consumedDrag = useCallback(() => {
    const moved = justDragged.current;
    justDragged.current = false;
    return moved;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: endGesture, onPointerCancel: endGesture, consumedDrag };
}
