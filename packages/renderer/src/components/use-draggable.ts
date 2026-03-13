import { useRef, useEffect, useCallback } from "react";

export function useDraggable(
  initialPos: { x: number; y: number },
  onDragEnd?: (pos: { x: number; y: number }) => void
) {
  const elRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(initialPos);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  // Sync posRef when initialPos changes (e.g. restoring from stored position)
  const initialPosRef = useRef(initialPos);
  if (initialPos.x !== initialPosRef.current.x || initialPos.y !== initialPosRef.current.y) {
    initialPosRef.current = initialPos;
    posRef.current = initialPos;
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const x = e.clientX - offset.current.x;
      const y = e.clientY - offset.current.y;
      posRef.current = { x, y };
      if (elRef.current) {
        elRef.current.style.left = `${x}px`;
        elRef.current.style.top = `${y}px`;
      }
    }
    function onUp() {
      if (dragging.current) {
        dragging.current = false;
        onDragEnd?.(posRef.current);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onDragEnd]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    e.preventDefault();
    dragging.current = true;
    offset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
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
