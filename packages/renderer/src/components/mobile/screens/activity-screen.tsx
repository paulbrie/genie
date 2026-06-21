"use client";

import { AtSign, Rocket, AlertTriangle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOCK_ACTIVITY, type ActivityKind, type MockActivity } from "@/components/mobile/mock-data";

const KIND_META: Record<ActivityKind, { icon: React.ReactNode; ring: string; tint: string }> = {
  mention: { icon: <AtSign size={13} />, ring: "bg-blue/15 text-blue", tint: "text-blue" },
  deploy: { icon: <Rocket size={13} />, ring: "bg-green/15 text-green", tint: "text-green" },
  alert: { icon: <AlertTriangle size={13} />, ring: "bg-red/15 text-red", tint: "text-red" },
  message: { icon: <MessageSquare size={13} />, ring: "bg-surface0 text-subtext0", tint: "text-subtext0" },
};

export function ActivityScreen() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface0 shrink-0">
        <span className="text-md font-semibold text-subtext0">Activity</span>
        <span className="text-xs text-overlay0">·</span>
        <span className="text-xs text-overlay0">2 unread</span>
        <button className="ml-auto text-sm text-blue active:opacity-70">Mark all read</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {MOCK_ACTIVITY.map((a) => (
          <ActivityRow key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ a }: { a: MockActivity }) {
  const meta = KIND_META[a.kind];
  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 border-b border-surface0/50",
        a.unread && "bg-mantle/60",
      )}
    >
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-full bg-surface0 text-subtext0 grid place-items-center text-sm font-semibold">
          {a.initials}
        </div>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 rounded-full grid place-items-center ring-2 ring-background",
            meta.ring,
          )}
          style={{ width: 18, height: 18 }}
        >
          {meta.icon}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-md font-semibold text-text truncate">{a.who}</span>
          <span className="text-xs text-overlay0 shrink-0 ml-auto">{a.when}</span>
        </div>
        <p className={cn("text-sm mt-0.5 leading-snug", a.kind === "alert" ? meta.tint : "text-subtext0")}>
          {a.text}
        </p>
      </div>
      {a.unread && <span className="w-2 h-2 rounded-full bg-blue shrink-0 mt-1.5" />}
    </div>
  );
}
