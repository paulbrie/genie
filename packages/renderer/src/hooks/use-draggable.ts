import { useRef, useEffect, useCallback } from "react";

// Minimum amount of the window that must stay inside the viewport so a user
// can always grab the title bar to drag it back. 40px ≈ title-bar height.
const MIN_VISIBLE = 40;

/** Clamp a candidate top-left position so the window stays grabbable:
 *   - `y` is clamped to [0, viewportH - MIN_VISIBLE] (top never above viewport).
 *   - `x` is clamped so at least MIN_VISIBLE is visible on either side. */
function clampToViewport(
  pos: { x: number; y: number },
  size: { w: number; h: number } | null,
): { x: number; y: number } {
  if (typeof window === "undefined") return pos;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = size?.w ?? 0;
  const maxX = vw - MIN_VISIBLE;
  const minX = w > 0 ? -(w - MIN_VISIBLE) : 0;
  const maxY = Math.max(0, vh - MIN_VISIBLE);
  const x = Math.min(Math.max(pos.x, minX), maxX);
  const y = Math.min(Math.max(pos.y, 0), maxY);
  return { x, y };
}

export function useDraggable(
  initialPos: { x: number; y: number },
  onDragEnd?: (pos: { x: number; y: number }) => void
) {
  const elRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(initialPos);
  const dragOriginRef = useRef(initialPos);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  // Sync posRef when initialPos changes (e.g. restoring from stored position)
  const initialPosRef = useRef(initialPos);
  if (initialPos.x !== initialPosRef.current.x || initialPos.y !== initialPosRef.current.y) {
    initialPosRef.current = initialPos;
    if (!dragging.current) {
      posRef.current = initialPos;
      dragOriginRef.current = initialPos;
      const el = elRef.current;
      if (el) {
        el.style.transform = "";
        el.style.willChange = "";
        el.style.left = `${initialPos.x}px`;
        el.style.top = `${initialPos.y}px`;
      }
    }
  }

  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el) return null;
    return { w: el.offsetWidth, h: el.offsetHeight };
  }, []);

  const commitPosition = useCallback((pos: { x: number; y: number }) => {
    const el = elRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.willChange = "";
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const raw = {
        x: e.clientX - offset.current.x,
        y: e.clientY - offset.current.y,
      };
      const pos = clampToViewport(raw, measure());
      posRef.current = pos;
      const el = elRef.current;
      if (!el) return;
      // Use transform while dragging so React re-renders (stats, focus, etc.)
      // don't reset left/top and thrash xterm's canvas renderer.
      const dx = pos.x - dragOriginRef.current.x;
      const dy = pos.y - dragOriginRef.current.y;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      commitPosition(posRef.current);
      onDragEnd?.(posRef.current);
    }
    // When the viewport shrinks (resize, devtools opening, mobile keyboard,
    // etc.), make sure the popup is still grabbable. Re-clamp the current
    // position and persist via onDragEnd if it actually moved.
    function onResize() {
      if (!elRef.current || dragging.current) return;
      const clamped = clampToViewport(posRef.current, measure());
      if (clamped.x === posRef.current.x && clamped.y === posRef.current.y) return;
      posRef.current = clamped;
      dragOriginRef.current = clamped;
      commitPosition(clamped);
      onDragEnd?.(clamped);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, [measure, onDragEnd, commitPosition]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    e.preventDefault();
    dragging.current = true;
    dragOriginRef.current = { ...posRef.current };
    offset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
    if (elRef.current) elRef.current.style.willChange = "transform";
  }, []);

  return { elRef, posRef, initialPos, onPointerDown };
}

export function useResizable(
  elRef: React.RefObject<HTMLDivElement | null>,
  initialSize: { w: number; h: number },
  minSize: { w: number; h: number } = { w: 280, h: 200 },
  onResizeEnd?: (size: { w: number; h: number }) => void
) {
  const sizeRef = useRef(initialSize);
  const resizing = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startSize = useRef({ w: 0, h: 0 });

  const initialSizeRef = useRef(initialSize);
  if (initialSize.w !== initialSizeRef.current.w || initialSize.h !== initialSizeRef.current.h) {
    initialSizeRef.current = initialSize;
    sizeRef.current = initialSize;
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!resizing.current) return;
      const w = Math.max(minSize.w, startSize.current.w + (e.clientX - startMouse.current.x));
      const h = Math.max(minSize.h, startSize.current.h + (e.clientY - startMouse.current.y));
      sizeRef.current = { w, h };
      if (elRef.current) {
        elRef.current.style.width = `${w}px`;
        elRef.current.style.height = `${h}px`;
      }
    }
    function onUp() {
      if (resizing.current) {
        resizing.current = false;
        onResizeEnd?.(sizeRef.current);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [elRef, minSize.w, minSize.h, onResizeEnd]);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    startMouse.current = { x: e.clientX, y: e.clientY };
    startSize.current = { ...sizeRef.current };
  }, []);

  return { sizeRef, onResizePointerDown };
}
