"use client";

// Global ⌘K / Ctrl+K palette: fuzzy search across everything the CURRENT USER
// can reach and jump straight to it. Access is respected by construction —
// projects + their servers come from $projects (already server-scoped to what the
// user may see); users / teams / orgs / cloud VMs come from $admin and are only
// offered to admins/superadmins (whose client has that data loaded). A standard
// user therefore only ever searches their own projects + servers.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Folder, Server, User, Users, Building2, Cloud, CornerDownLeft } from "lucide-react";
import { useSubject } from "subjecto/react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $auth, $projects, $admin } from "@/store/subjects";
import {
  selectProject, switchNav, setAdminTab, loadAdminUsers, loadAdminTeams,
} from "@/store/actions";
import { openManageVmWindow } from "@/components/tazcloud/manage-vm-popup";
import { openManageDropletWindow } from "@/components/admin/digitalocean-panel";
import { openManageServerWindow } from "@/components/admin/hetzner-panel";
import type { VpsInstance } from "@/store/types";
import { cn } from "@/lib/utils";

type Category = "Project" | "Server" | "User" | "Team" | "Org" | "Cloud";

interface PaletteItem {
  key: string;
  category: Category;
  label: string;
  sublabel?: string;
  run: () => void;
}

const CATEGORY_ICON: Record<Category, typeof Folder> = {
  Project: Folder, Server: Server, User: User, Team: Users, Org: Building2, Cloud: Cloud,
};

function openManageForInstance(inst: VpsInstance): void {
  if (inst.tazcloud?.vmId) openManageVmWindow({ id: inst.tazcloud.vmId, name: inst.label });
  else if (inst.digitalocean?.dropletId) openManageDropletWindow({ id: inst.digitalocean.dropletId, name: inst.label });
  else if (inst.hetzner?.serverId) openManageServerWindow({ id: inst.hetzner.serverId, name: inst.label });
  else openManageVmWindow({ id: inst.id, name: inst.label });
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [auth] = useSubject($auth);
  const [projects] = useSubject($projects);
  const admin = useDeepSubjectAll($admin);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const role = auth.user?.role;
  const isAdmin = role === "admin" || role === "superadmin";

  // Global open shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Populate admin-only catalogs on open so search has data to match.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    if (isAdmin) {
      if (admin.users.list.length === 0) loadAdminUsers();
      if (admin.teams.list.length === 0) loadAdminTeams();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    // Projects + their servers — already scoped to what this user can see.
    for (const p of projects) {
      out.push({ key: `project:${p.id}`, category: "Project", label: p.name, run: () => { selectProject(p.id); close(); } });
      for (const inst of p.vpsInstances ?? []) {
        const host = inst.digitalocean?.ipAddress || inst.hetzner?.ipAddress || inst.tazcloud?.ipv6;
        out.push({
          key: `vm:${p.id}:${inst.id}`,
          category: "Server",
          label: inst.label,
          sublabel: [p.name, host].filter(Boolean).join(" · "),
          run: () => { openManageForInstance(inst); close(); },
        });
      }
    }
    // Admin-only catalogs.
    if (isAdmin) {
      for (const u of admin.users.list) {
        out.push({ key: `user:${u.id}`, category: "User", label: u.name || u.email, sublabel: u.email, run: () => { switchNav("admin"); setAdminTab("users"); close(); } });
      }
      for (const t of admin.teams.list) {
        out.push({ key: `team:${t.id}`, category: "Team", label: t.name, run: () => { switchNav("admin"); setAdminTab("teams"); close(); } });
      }
      for (const o of admin.orgs.list) {
        out.push({ key: `org:${o.id}`, category: "Org", label: o.name, run: () => { switchNav("admin"); setAdminTab("orgs"); close(); } });
      }
      for (const d of admin.droplets) {
        out.push({ key: `do:${d.id}`, category: "Cloud", label: d.name, sublabel: "DigitalOcean", run: () => { openManageDropletWindow({ id: d.id, name: d.name }); close(); } });
      }
      for (const s of admin.hetzner.servers) {
        out.push({ key: `hz:${s.id}`, category: "Cloud", label: s.name, sublabel: "Hetzner", run: () => { openManageServerWindow({ id: s.id, name: s.name }); close(); } });
      }
      for (const vm of admin.tazcloud.vms) {
        out.push({ key: `taz:${vm.id}`, category: "Cloud", label: vm.name, sublabel: "TazCloud", run: () => { openManageVmWindow({ id: vm.id, name: vm.name }); close(); } });
      }
    }
    return out;
  }, [projects, admin, isAdmin, close]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    const scored = items
      .map((it) => {
        const hay = `${it.label} ${it.sublabel ?? ""} ${it.category}`.toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) return null;
        // Rank: label-prefix match first, then earlier matches.
        const rank = it.label.toLowerCase().startsWith(q) ? 0 : it.label.toLowerCase().includes(q) ? 1 : 2 + idx;
        return { it, rank };
      })
      .filter((x): x is { it: PaletteItem; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 50);
    return scored.map((s) => s.it);
  }, [items, query]);

  const idx = Math.min(active, Math.max(0, filtered.length - 1));
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [idx, open]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[idx]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }, [filtered, idx, close]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[3000000] flex items-start justify-center pt-[12vh] bg-black/40" onMouseDown={close}>
      <div
        className="w-[560px] max-w-[92vw] bg-mantle border border-surface0 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface0">
          <Search size={15} className="text-overlay0 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search projects, servers, users, teams, clouds…"
            className="flex-1 bg-transparent text-text text-md outline-none placeholder:text-overlay0"
          />
          <kbd className="text-[10px] text-overlay0 border border-surface0 rounded px-1 py-0.5">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1 scrollbar-thin">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-overlay0 text-md">No matches</div>
          ) : (
            filtered.map((it, i) => {
              const Icon = CATEGORY_ICON[it.category];
              return (
                <button
                  key={it.key}
                  ref={i === idx ? activeRef : undefined}
                  onClick={it.run}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-1.5 text-left border-none cursor-pointer transition-colors",
                    i === idx ? "bg-surface0" : "bg-transparent",
                  )}
                >
                  <Icon size={14} className="text-overlay0 shrink-0" />
                  <span className="text-text text-md truncate flex-1">{it.label}</span>
                  {it.sublabel && <span className="text-overlay0 text-xs truncate max-w-[40%]">{it.sublabel}</span>}
                  <span className="text-[10px] uppercase tracking-wide text-overlay0/70 shrink-0 w-14 text-right">{it.category}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-surface0 text-[10px] text-overlay0">
          <span className="inline-flex items-center gap-1"><CornerDownLeft size={10} /> open</span>
          <span>↑↓ navigate</span>
          <span className="ml-auto">{filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
