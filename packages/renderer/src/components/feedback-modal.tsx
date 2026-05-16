"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Loader2, Send } from "lucide-react";
import { submitFeedback } from "@/store/actions";
import { cn } from "@/lib/utils";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "feedback:submitted") {
          setSubmitting(false);
          setSubmitted(true);
          setTimeout(() => { setSubmitted(false); setTitle(""); setDescription(""); onClose(); }, 1500);
        } else if (msg.type === "feedback:error") {
          setSubmitting(false);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [open, onClose]);

  const handleSubmit = useCallback(() => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    submitFeedback(title.trim(), description.trim());
    // Optimistic: close after short delay if no WS response
    setTimeout(() => {
      setSubmitting(false);
      setTitle("");
      setDescription("");
      onClose();
    }, 3000);
  }, [title, description, submitting, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[90vw] bg-mantle border border-surface0 rounded-lg shadow-xl z-50 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0">
          <span className="text-text font-medium text-md">Send Feedback</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-1">
            <label className="text-overlay1 text-md">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="What's on your mind?"
              className="bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve text-md border-none"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-overlay1 text-md">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any details, suggestions, or bug reports..."
              rows={4}
              className="bg-surface0 text-text rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-mauve resize-none text-md border-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-overlay1 hover:text-text text-md bg-transparent border-none cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded hover:opacity-90 transition-opacity disabled:opacity-50 text-md border-none cursor-pointer",
              submitted ? "bg-green text-crust" : "bg-mauve text-crust",
            )}
          >
            {submitting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : submitted ? (
              "Sent!"
            ) : (
              <>
                <Send size={13} />
                Submit
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
