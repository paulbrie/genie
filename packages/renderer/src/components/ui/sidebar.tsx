"use client";

import { useEffect, useMemo, useState } from "react";
import { useSubject } from "subjecto/react";
import { TerminalSquare, LogOut, Radio, MessageSquarePlus } from "lucide-react";
import type { AuthUser } from "@/store/types";
import { $auth, $manager } from "@/store/subjects";
import { addTerminalTab, markUpdatesSeen } from "@/store/actions";
import { logout } from "@/lib/ws";
import { SystemStats } from "@/components/ui/system-stats";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import { FileExplorerToggle } from "@/components/project/file-explorer-toggle";
import { FeedbackModal } from "@/components/ui/feedback-modal";
import { UpdateLogModal } from "@/components/ui/update-log-modal";
import { unseenChangelogEntries, latestChangelogVersion } from "@/lib/changelog";
import { cn } from "@/lib/utils";
import { useWsLogCount } from "@/components/ui/ws-log-drawer";

export function Sidebar({
  wsLogOpen,
  onToggleWsLog,
}: {
  wsLogOpen?: boolean;
  onToggleWsLog?: () => void;
}) {
  const [manager] = useSubject($manager);
  const [auth] = useSubject($auth);
  const managerRunning = manager.running;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const role = auth.user?.role;
  const isAdmin = role === "admin" || role === "superadmin";

  // "What's new" modal: opens automatically when the authenticated user has
  // unacknowledged changelog entries. We freeze the entries the moment we
  // open so dismissing doesn't yank items out from under the render, and we
  // track shown-state per user id so re-auth as a different user re-checks.
  const userId = auth.user?.id ?? null;
  const lastSeen = auth.user?.lastSeenUpdateVersion ?? null;
  const [updateModalState, setUpdateModalState] = useState<{
    open: boolean;
    entries: ReturnType<typeof unseenChangelogEntries>;
    shownForUser: string | null;
  }>({ open: false, entries: [], shownForUser: null });

  useEffect(() => {
    if (auth.status !== "authenticated" || !userId) return;
    if (updateModalState.shownForUser === userId) return;
    const entries = unseenChangelogEntries(lastSeen);
    if (entries.length === 0) {
      setUpdateModalState({ open: false, entries: [], shownForUser: userId });
      return;
    }
    setUpdateModalState({ open: true, entries, shownForUser: userId });
  }, [auth.status, userId, lastSeen, updateModalState.shownForUser]);

  const closeUpdateModal = useMemo(
    () => () => {
      const latest = latestChangelogVersion();
      if (latest) markUpdatesSeen(latest);
      setUpdateModalState((s) => ({ ...s, open: false }));
    },
    [],
  );

  return (
    <aside className="w-60 min-w-60 bg-mantle border-r border-surface0 flex flex-col gap-2.5 px-3 pb-3 pt-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-mauve">Genie</h1>
        <span
          className={cn(
            "w-2 h-2 rounded-full",
            managerRunning
              ? "bg-green shadow-[0_0_4px_var(--color-green)]"
              : "bg-overlay0",
          )}
        />
      </div>

      <SystemStats />
      <SidebarNav />
      <div className="mt-auto pt-2 border-t border-surface0 flex flex-col gap-0.5">
        {isAdmin && (
          <>
            <FileExplorerToggle />
            <TerminalToggle />
            <FeedbackToggle onOpen={() => setFeedbackOpen(true)} />
            {onToggleWsLog && (
              <WsLogToggle open={!!wsLogOpen} onToggle={onToggleWsLog} />
            )}
          </>
        )}
        <UserBadge />
      </div>
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <UpdateLogModal
        open={updateModalState.open}
        entries={updateModalState.entries}
        onClose={closeUpdateModal}
      />
    </aside>
  );
}

function UserBadge() {
  const [auth] = useSubject($auth);
  const user = auth.user as AuthUser | null;
  if (!user) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
      <div className="w-5 h-5 rounded-full bg-surface1 shrink-0 overflow-hidden">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-md font-medium text-subtext0">
            {user.name[0]?.toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-md text-subtext0 truncate">{user.name}</span>
        {user.role && user.role !== "user" && (
          <span
            className={cn(
              "text-xs",
              user.role === "superadmin"
                ? "text-mauve"
                : user.role === "tazcloud"
                  ? "text-teal"
                  : "text-blue",
            )}
          >
            {user.role}
          </span>
        )}
      </div>
      <button
        onClick={logout}
        className="p-0.5 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-red transition-colors"
        title="Sign out"
      >
        <LogOut size={12} />
      </button>
    </div>
  );
}

function TerminalToggle() {
  return (
    <button
      onClick={() => addTerminalTab()}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-base text-subtext0",
        "hover:bg-surface0 hover:text-text transition-colors",
      )}
      title="New Terminal"
    >
      <TerminalSquare size={16} />
      <span>Terminal</span>
    </button>
  );
}

function FeedbackToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-base text-subtext0",
        "hover:bg-surface0 hover:text-text transition-colors",
      )}
      title="Send Feedback"
    >
      <MessageSquarePlus size={16} />
      <span>Feedback</span>
    </button>
  );
}

function WsLogToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const count = useWsLogCount();

  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-base text-subtext0",
        "hover:bg-surface0 hover:text-text transition-colors",
        open && "bg-surface0 text-text",
      )}
      title="Toggle WS Message Log"
    >
      <Radio size={16} />
      <span className="flex-1 text-left">WS Log</span>
      {count > 0 && (
        <span className="text-md text-overlay0 bg-surface0 px-1.5 py-0.5 rounded-full tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}
