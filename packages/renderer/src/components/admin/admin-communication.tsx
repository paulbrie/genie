"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Mail, Send, Check, X, Search, Users } from "lucide-react";
import type { AdminState, AdminUser, EmailLogEntry } from "@/store/types";
import { loadAdminUsers, loadEmailLogs, sendCommunicationEmail } from "@/store/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const LOGS_PAGE_SIZE = 50;

export function CommunicationPanel({
  communication,
  users,
}: {
  communication: AdminState["communication"];
  users: AdminState["users"];
}) {
  const [mode, setMode] = useState<"all" | "specific">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [userFilter, setUserFilter] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Logs filtering + pagination
  const [logFilter, setLogFilter] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The component owns its data fetch so deep-linking to /admin/communication works.
  useEffect(() => {
    loadEmailLogs();
    if (users.list.length === 0) loadAdminUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real, validated people (exclude agent accounts — they're not emailable users).
  const realUsers = useMemo(
    () => users.list.filter((u: AdminUser) => !u.isAgent && u.email),
    [users.list],
  );

  const validatedCount = useMemo(() => realUsers.filter((u) => u.validated).length, [realUsers]);

  const filteredUsers = useMemo(() => {
    const f = userFilter.trim().toLowerCase();
    if (!f) return realUsers;
    return realUsers.filter(
      (u) => u.name.toLowerCase().includes(f) || u.email.toLowerCase().includes(f),
    );
  }, [realUsers, userFilter]);

  const recipientCount = mode === "all" ? validatedCount : selected.size;

  const toggleUser = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSend =
    !communication.sending &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    recipientCount > 0;

  const handleSend = () => {
    if (!canSend) return;
    sendCommunicationEmail({
      allUsers: mode === "all",
      recipientUserIds: mode === "all" ? [] : Array.from(selected),
      subject: subject.trim(),
      body: body.trim(),
    });
  };

  // Clear the form after a successful send (lastResult flips to a summary).
  useEffect(() => {
    if (communication.lastResult) {
      setSubject("");
      setBody("");
      setSelected(new Set());
    }
  }, [communication.lastResult]);

  // --- Logs ---
  const lowerLog = logFilter.toLowerCase();
  const filteredLogs = lowerLog
    ? communication.logs.filter(
        (l: EmailLogEntry) =>
          l.recipientEmail.toLowerCase().includes(lowerLog) ||
          l.subject.toLowerCase().includes(lowerLog) ||
          (l.sentByName?.toLowerCase().includes(lowerLog) ?? false),
      )
    : communication.logs;

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedLogs = filteredLogs.slice(safePage * LOGS_PAGE_SIZE, (safePage + 1) * LOGS_PAGE_SIZE);

  useEffect(() => { setPage(0); }, [logFilter]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ===== Compose ===== */}
      <div className="w-[480px] shrink-0 border-r border-surface0 flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-surface0 flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue" />
          <span className="text-base font-medium text-text">Compose</span>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Recipient mode */}
          <div className="flex flex-col gap-2">
            <label className="text-md text-overlay1">Recipients</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("all")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border cursor-pointer text-md transition-colors",
                  mode === "all"
                    ? "bg-surface0 border-blue text-text"
                    : "bg-transparent border-surface1 text-overlay0 hover:text-text",
                )}
              >
                <Users className="w-3.5 h-3.5" />
                All users
                <span className="text-overlay0">({validatedCount})</span>
              </button>
              <button
                onClick={() => setMode("specific")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded border cursor-pointer text-md transition-colors",
                  mode === "specific"
                    ? "bg-surface0 border-blue text-text"
                    : "bg-transparent border-surface1 text-overlay0 hover:text-text",
                )}
              >
                Specific users
                {selected.size > 0 && <span className="text-overlay0">({selected.size})</span>}
              </button>
            </div>
          </div>

          {/* User picker (specific mode) */}
          {mode === "specific" && (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-overlay0 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search users..."
                  className="w-full bg-surface0 text-text border border-surface1 rounded pl-7 pr-2 py-1.5 text-md"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                />
              </div>
              <div className="border border-surface1 rounded max-h-56 overflow-y-auto">
                {users.loading && realUsers.length === 0 ? (
                  <div className="px-3 py-4 text-overlay0 text-md text-center">Loading users...</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="px-3 py-4 text-overlay0 text-md text-center">No users found</div>
                ) : (
                  filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => toggleUser(u.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 border-none bg-transparent cursor-pointer hover:bg-surface0/50 text-left"
                    >
                      <span
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                          selected.has(u.id) ? "bg-blue border-blue" : "border-surface1",
                        )}
                      >
                        {selected.has(u.id) && <Check className="w-3 h-3 text-mantle" />}
                      </span>
                      <span className="flex flex-col min-w-0">
                        <span className="text-md text-text truncate">{u.name}</span>
                        <span className="text-md text-overlay0 truncate">{u.email}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="flex flex-col gap-2">
            <label className="text-md text-overlay1">Subject</label>
            <input
              type="text"
              placeholder="Email subject"
              className="w-full bg-surface0 text-text border border-surface1 rounded px-2 py-1.5 text-md"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-2">
            <label className="text-md text-overlay1">Message</label>
            <textarea
              placeholder="Write your message to users..."
              className="w-full bg-surface0 text-text border border-surface1 rounded px-2 py-1.5 text-md min-h-[180px] resize-y font-sans leading-relaxed"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <span className="text-md text-overlay0">Plain text — line breaks are preserved in the email.</span>
          </div>

          {/* Banners */}
          {communication.error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded bg-red/10 border border-red/30 text-red text-md">
              <X className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{communication.error}</span>
            </div>
          )}
          {communication.lastResult && (
            <div
              className={cn(
                "flex items-start gap-2 px-3 py-2 rounded text-md border",
                communication.lastResult.failed === 0
                  ? "bg-green/10 border-green/30 text-green"
                  : "bg-yellow/10 border-yellow/30 text-yellow",
              )}
            >
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Sent {communication.lastResult.sent}/{communication.lastResult.total}
                {communication.lastResult.failed > 0 && ` · ${communication.lastResult.failed} failed`}.
              </span>
            </div>
          )}

          {/* Send */}
          <div className="flex items-center gap-3">
            <Button onClick={handleSend} disabled={!canSend}>
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {communication.sending
                ? "Sending..."
                : `Send to ${recipientCount} ${recipientCount === 1 ? "user" : "users"}`}
            </Button>
          </div>
        </div>
      </div>

      {/* ===== Logs ===== */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-surface0 flex items-center gap-3">
          <span className="text-base font-medium text-text">Email Logs</span>
          <Button size="sm" onClick={() => loadEmailLogs()}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", communication.loading && "animate-spin")} />
            Refresh
          </Button>
          <input
            type="text"
            placeholder="Filter by recipient, subject, sender..."
            className="bg-surface0 text-text border border-surface1 rounded px-2 py-1 text-md w-64"
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
          />
          <span className="text-md text-overlay0">{filteredLogs.length} entries</span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-md text-overlay1">{safePage + 1} / {totalPages}</span>
            <Button size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-md">
            <thead className="sticky top-0 bg-mantle z-10">
              <tr className="text-left text-overlay0">
                <th className="px-4 py-2 font-medium w-44">Time</th>
                <th className="px-4 py-2 font-medium w-24">Status</th>
                <th className="px-4 py-2 font-medium w-56">Recipient</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium w-36">Sent by</th>
              </tr>
            </thead>
            <tbody>
              {communication.loading && pagedLogs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-overlay0">Loading...</td></tr>
              ) : pagedLogs.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-overlay0">No emails sent yet</td></tr>
              ) : (
                pagedLogs.map((log: EmailLogEntry) => (
                  <tr
                    key={log.id}
                    className="border-t border-surface0 hover:bg-surface0/50 cursor-pointer align-top"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td className="px-4 py-2 text-overlay1 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded font-medium",
                          log.status === "sent" ? "bg-green/15 text-green" : "bg-red/15 text-red",
                        )}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-text truncate max-w-[14rem]">{log.recipientEmail}</td>
                    <td className="px-4 py-2 text-overlay1">
                      <span className="text-text">{log.subject}</span>
                      {expandedId === log.id && (
                        <div className="mt-2 flex flex-col gap-2">
                          <pre className="whitespace-pre-wrap text-md text-overlay1 max-h-60 overflow-auto bg-mantle rounded p-2 border border-surface0">
                            {log.body}
                          </pre>
                          {log.error && (
                            <div className="text-red text-md">Error: {log.error}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-overlay0 truncate">{log.sentByName || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
