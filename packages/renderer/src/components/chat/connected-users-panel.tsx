"use client";

import { useEffect, useMemo } from "react";
import { useSubject } from "subjecto/react";
import { Users, Monitor, Chrome, MapPin, Globe, Wifi, AppWindow } from "lucide-react";
import type { PresenceSession } from "@/store/types";
import { $presenceSessions } from "@/store/subjects";
import { requestPresenceDetail } from "@/store/actions";
import { iconMap } from "@/components/ui/window-toolbar";
function parseBrowser(ua: string | null): string {
  if (!ua) return "Unknown";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  if (ua.includes("Chrome/") && !ua.includes("Chromium")) return "Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("Firefox/")) return "Firefox";
  return "Unknown";
}

function parseOS(ua: string | null): string {
  if (!ua) return "";
  if (ua.includes("Mac OS")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  return "";
}

function formatNav(nav: string | null): string {
  if (!nav) return "Unknown";
  return nav.charAt(0).toUpperCase() + nav.slice(1);
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface GroupedUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  sessions: PresenceSession[];
}

export function ConnectedUsersPanel() {
  const [sessions] = useSubject($presenceSessions);

  useEffect(() => {
    requestPresenceDetail();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedUser>();
    for (const s of sessions) {
      if (!map.has(s.id)) {
        map.set(s.id, { id: s.id, name: s.name, email: s.email, avatarUrl: s.avatarUrl, sessions: [] });
      }
      map.get(s.id)!.sessions.push(s);
    }
    return [...map.values()];
  }, [sessions]);

  // Merge all actions from all sessions per user, sorted by ts desc
  function getUserActions(user: GroupedUser): { type: string; ts: number }[] {
    const all: { type: string; ts: number }[] = [];
    for (const s of user.sessions) {
      for (const a of s.recentActions) all.push(a);
    }
    all.sort((a, b) => b.ts - a.ts);
    return all.slice(0, 25);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 h-12 border-b border-surface0 shrink-0 px-4">
        <Users size={14} className="text-mauve" />
        <h2 className="text-lg font-semibold text-text">Connected Users</h2>
        {grouped.length > 0 && (
          <span className="text-[11px] text-overlay0 bg-surface0 px-1.5 py-0.5 rounded-full">{grouped.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-overlay0 gap-2 text-md">
            <Users size={24} />
            <p>No connected users</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {grouped.map((user) => {
              const actions = getUserActions(user);
              return (
                <div key={user.id} className="bg-mantle border border-surface0 rounded-lg overflow-hidden">
                  {/* User header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-surface0">
                    <div className="w-8 h-8 rounded-full bg-surface1 shrink-0 overflow-hidden">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-md font-medium text-subtext0">
                          {user.name[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-text text-md font-medium truncate">{user.name}</span>
                      <span className="text-overlay0 text-[11px] truncate">{user.email}</span>
                    </div>
                    <span className="text-[11px] text-green bg-green/10 px-2 py-0.5 rounded-full">online</span>
                  </div>

                  {/* Sessions */}
                  <div className="px-4 py-2 border-b border-surface0 flex flex-col gap-2">
                    {user.sessions.map((s, i) => {
                      const browser = parseBrowser(s.userAgent);
                      const os = parseOS(s.userAgent);
                      return (
                        <div key={i} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 text-[11px] text-overlay1">
                            {s.clientType === "chrome-extension" ? (
                              <Chrome size={12} className="shrink-0 text-blue" />
                            ) : (
                              <Monitor size={12} className="shrink-0 text-mauve" />
                            )}
                            <span>{s.clientType === "chrome-extension" ? "Extension" : "Web"}</span>
                            {s.currentNav && (
                              <>
                                <MapPin size={10} className="shrink-0 text-overlay0" />
                                <span className="text-text">{formatNav(s.currentNav)}</span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-overlay0 pl-5">
                            <span className="flex items-center gap-1">
                              <Globe size={10} className="shrink-0" />
                              {browser}{os ? ` / ${os}` : ""}
                            </span>
                            {s.ip && (
                              <span className="flex items-center gap-1">
                                <Wifi size={10} className="shrink-0" />
                                {s.ip}
                              </span>
                            )}
                          </div>
                          {s.openWindows && s.openWindows.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pl-5">
                              {s.openWindows.map((w, wi) => {
                                const Icon = iconMap[w.icon] || AppWindow;
                                return (
                                  <span
                                    key={wi}
                                    className={
                                      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] " +
                                      (w.minimized ? "bg-surface0 text-overlay0" : "bg-mauve/15 text-mauve")
                                    }
                                    title={w.minimized ? "minimized" : "open"}
                                  >
                                    <Icon size={10} className="shrink-0" />
                                    {w.title}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Recent actions */}
                  <div className="max-h-[250px] overflow-y-auto">
                    {actions.length === 0 ? (
                      <div className="px-4 py-3 text-overlay0 text-[11px]">No recent actions</div>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-base sticky top-0">
                            <th className="text-left px-4 py-1.5 text-overlay0 font-medium">Action</th>
                            <th className="text-right px-4 py-1.5 text-overlay0 font-medium">When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {actions.map((a, i) => (
                            <tr key={i} className="border-t border-surface0/50 hover:bg-surface0/20">
                              <td className="px-4 py-1 text-text font-mono">{a.type}</td>
                              <td className="px-4 py-1 text-overlay0 text-right whitespace-nowrap">{timeAgo(a.ts)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
