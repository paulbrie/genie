"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={cn(
        "fixed z-[1000] bg-surface0 border border-surface1 rounded-lg p-1",
        "shadow-lg shadow-black/40"
      )}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
}

interface ContextMenuItemProps {
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

export function ContextMenuItem({
  onClick,
  className,
  children,
}: ContextMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full bg-transparent border-none text-base font-medium",
        "py-1.5 px-3.5 rounded-[5px] cursor-pointer text-left whitespace-nowrap",
        "hover:bg-surface1",
        className
      )}
    >
      {children}
    </button>
  );
}
