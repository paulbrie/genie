"use client";

import { forwardRef, useRef, useEffect, useCallback, useImperativeHandle, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface AutoTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onSubmit"> {
  onSubmit?: () => void;
  minRows?: number;
  maxRows?: number;
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(function AutoTextarea({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  minRows = 1,
  maxRows = 6,
  className,
  ...props
}, ref) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current!);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const maxHeight = lineHeight * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Give the parent first dibs — it may consume the key (e.g. an open
    // autocomplete menu accepting a suggestion on Enter/Tab). If it called
    // preventDefault, we don't also submit.
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <textarea
      ref={innerRef}
      rows={minRows}
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      className={cn("resize-none", className)}
      {...props}
    />
  );
});
