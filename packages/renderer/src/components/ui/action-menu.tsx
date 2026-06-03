"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const actionMenuPanelClass =
  "bg-mantle border border-overlay0/30 rounded-md shadow-lg py-1 min-w-[220px]";

const actionMenuItemClass =
  "w-full text-left px-3 py-1.5 text-md hover:bg-surface0 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed";

/** Click-away layer behind anchored or fixed menus. */
export function ActionMenuBackdrop({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-[999]" onClick={onClose} aria-hidden />;
}

export const ActionMenuPanel = forwardRef<
  HTMLDivElement,
  { children: ReactNode; className?: string; style?: React.CSSProperties }
>(function ActionMenuPanel({ children, className, style }, ref) {
  return (
    <div ref={ref} className={cn(actionMenuPanelClass, "z-[1000]", className)} style={style}>
      {children}
    </div>
  );
});

export function ActionMenuDivider() {
  return <div className="my-1 border-t border-overlay0/15" />;
}

export function ActionMenuItem({
  icon: Icon,
  iconClassName,
  onClick,
  disabled,
  loading,
  variant = "default",
  title,
  children,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "default" | "danger";
  title?: string;
  children: ReactNode;
}) {
  const danger = variant === "danger";
  const iconColor = iconClassName ?? (danger ? "text-red" : "text-overlay0");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={cn(actionMenuItemClass, danger && "hover:bg-red/10 text-red")}
    >
      {loading ? (
        <Loader2 size={12} className={cn("shrink-0 animate-spin", iconColor)} />
      ) : Icon ? (
        <Icon size={12} className={cn("shrink-0", iconColor)} />
      ) : null}
      {children}
    </button>
  );
}

/** Right-click / pointer menu at viewport coordinates (tmux pills, file lists, etc.). */
export function ContextActionMenu({
  x,
  y,
  onClose,
  children,
  blockClose = false,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  blockClose?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !blockClose) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, blockClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y, children]);

  return (
    <>
      <ActionMenuBackdrop onClose={blockClose ? () => {} : onClose} />
      <ActionMenuPanel ref={ref} className="fixed" style={{ left: x, top: y }}>
        {children}
      </ActionMenuPanel>
    </>
  );
}
