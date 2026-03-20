"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useSubject } from "subjecto/react";
import { Bot, X, Plus, Search, MessageSquare } from "lucide-react";
import {
  $conversationChat,
  $auth,
  addMemberToConversation,
  removeMemberFromConversation,
  openDmWith,
  type ChatUser,
  type ConversationMember,
  type ConversationSummary,
  type AuthUser,
} from "@/store";
import { cn } from "@/lib/utils";

export function ChatUsersPanel() {
  const [conversationChat] = useSubject($conversationChat);
  const { activeConversationId, conversations, members, users } = conversationChat;

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  if (activeConv?.type === "room") {
    return <RoomMembersPanel conversationId={activeConv.id} members={members} users={users} />;
  }

  return <GlobalUsersPanel users={users} />;
}

// --- Global Users Panel (original behavior) ---

function GlobalUsersPanel({ users }: { users: ChatUser[] }) {
  const sorted = [...users].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.isAgent !== b.isAgent) return a.isAgent ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="w-[180px] shrink-0 border-l border-surface0 flex flex-col">
      <div className="px-3 py-2 border-b border-surface0">
        <h2 className="text-md font-semibold uppercase tracking-wide text-subtext0">
          Users
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 flex flex-col gap-0.5">
        {sorted.map((user) => (
          <UserRow key={user.id} user={user} />
        ))}
        {users.length === 0 && (
          <p className="text-md text-overlay0 px-2 py-4 text-center">No users yet</p>
        )}
      </div>
    </div>
  );
}

// --- Room Members Panel ---

function RoomMembersPanel({
  conversationId,
  members,
  users,
}: {
  conversationId: string;
  members: ConversationMember[];
  users: ChatUser[];
}) {
  const [auth] = useSubject($auth);
  const authUser = auth.user as AuthUser | null;
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  // Enrich members with online status from users list
  const enrichedMembers = members.map((m) => {
    const userInfo = users.find((u) => u.id === m.userId);
    return { ...m, online: userInfo?.online ?? false };
  });

  // Sort: online first, then agents, then alphabetical
  const sorted = [...enrichedMembers].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.isAgent !== b.isAgent) return a.isAgent ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Users not already in the room, filtered by search
  const nonMembers = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.userId));
    return users
      .filter((u) => !memberIds.has(u.id))
      .filter((u) =>
        searchFilter ? u.name.toLowerCase().includes(searchFilter.toLowerCase()) : true,
      );
  }, [users, members, searchFilter]);

  return (
    <div className="w-[180px] shrink-0 border-l border-surface0 flex flex-col">
      <div className="px-3 py-2 border-b border-surface0">
        <h2 className="text-md font-semibold uppercase tracking-wide text-subtext0">
          Members ({members.length})
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 flex flex-col gap-0.5">
        {sorted.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isSelf={member.userId === authUser?.id}
            onRemove={() => removeMemberFromConversation(conversationId, member.userId)}
          />
        ))}
      </div>

      {/* Add Member */}
      <div className="border-t border-surface0 px-2 py-2 relative">
        {showAddDropdown ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 bg-surface0 rounded-md px-2 py-1">
              <Search size={10} className="text-overlay0 shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search users..."
                className="flex-1 bg-transparent border-none text-md text-text placeholder:text-overlay0 outline-none"
              />
              <button
                onClick={() => { setShowAddDropdown(false); setSearchFilter(""); }}
                className="p-0 bg-transparent border-none cursor-pointer text-overlay0 hover:text-text"
              >
                <X size={10} />
              </button>
            </div>
            <div className="max-h-[150px] overflow-y-auto scrollbar-thin flex flex-col gap-0.5">
              {nonMembers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => {
                    addMemberToConversation(conversationId, user.id);
                    setSearchFilter("");
                  }}
                  className="flex items-center gap-2 px-2 py-1 rounded-md bg-transparent border-none cursor-pointer text-left hover:bg-surface0 transition-colors w-full"
                >
                  <UserAvatar user={user} size="small" />
                  <span className="text-md text-text truncate">{user.name}</span>
                </button>
              ))}
              {nonMembers.length === 0 && (
                <p className="text-md text-overlay0 px-2 py-2 text-center">No users to add</p>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddDropdown(true)}
            className="flex items-center gap-1 w-full px-2 py-1 rounded-md bg-transparent border-none cursor-pointer text-overlay0 hover:text-text hover:bg-surface0 transition-colors text-md"
          >
            <Plus size={12} />
            Add Member
          </button>
        )}
      </div>
    </div>
  );
}

// --- Shared components ---

function UserAvatar({ user, size = "normal" }: { user: { name: string; avatarUrl: string | null; isAgent: boolean; online?: boolean }; size?: "small" | "normal" }) {
  const dim = size === "small" ? "w-4 h-4" : "w-5 h-5";
  const iconSize = size === "small" ? 10 : 12;
  const textSize = size === "small" ? "text-[8px]" : "text-md";

  return (
    <div className="relative shrink-0">
      {user.isAgent ? (
        <div className={cn(dim, "rounded-full bg-blue/20 flex items-center justify-center")}>
          <Bot size={iconSize} className="text-blue" />
        </div>
      ) : (
        <div className={cn(dim, "rounded-full bg-surface1 overflow-hidden flex items-center justify-center")}>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className={cn(textSize, "font-medium text-subtext0")}>
              {user.name[0]?.toUpperCase()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function UserRow({ user }: { user: ChatUser }) {
  const [auth] = useSubject($auth);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isSelf = auth.user?.id === user.id;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isSelf) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [isSelf]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [ctxMenu]);

  return (
    <>
      <div className="flex items-center gap-2 px-2 py-1 rounded-md" onContextMenu={handleContextMenu}>
        <div className="relative shrink-0">
          <UserAvatar user={user} />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-mantle",
              user.isAgent
                ? "bg-blue"
                : user.online
                  ? "bg-green"
                  : "bg-overlay0"
            )}
          />
        </div>
        <span
          className={cn(
            "text-md truncate",
            user.online || user.isAgent ? "text-text" : "text-overlay0"
          )}
        >
          {user.name}
        </span>
      </div>
      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-mantle border border-surface0 rounded-lg shadow-lg py-1 min-w-[120px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            onClick={() => { openDmWith(user.id); setCtxMenu(null); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 bg-transparent border-none cursor-pointer text-md text-text hover:bg-surface0 transition-colors text-left"
          >
            <MessageSquare size={13} className="text-overlay1" />
            Chat
          </button>
        </div>
      )}
    </>
  );
}

function MemberRow({
  member,
  isSelf,
  onRemove,
}: {
  member: ConversationMember & { online: boolean };
  isSelf: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface0/50 transition-colors">
      <div className="relative shrink-0">
        <UserAvatar user={{ ...member, avatarUrl: member.avatarUrl }} />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-mantle",
            member.isAgent
              ? "bg-blue"
              : member.online
                ? "bg-green"
                : "bg-overlay0"
          )}
        />
      </div>
      <span
        className={cn(
          "text-md truncate flex-1",
          member.online || member.isAgent ? "text-text" : "text-overlay0"
        )}
      >
        {member.name}
      </span>
      {!isSelf && !member.isAgent && (
        <button
          onClick={onRemove}
          className="hidden group-hover:flex p-0.5 bg-transparent border-none cursor-pointer text-overlay0 hover:text-red rounded transition-colors"
          title="Remove member"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}
