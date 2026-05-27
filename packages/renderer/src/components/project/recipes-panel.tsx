"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSubject } from "subjecto/react";
import { ChefHat, RefreshCw, Plus, Trash2, Save, X, Loader2, Pencil } from "lucide-react";
import type { UserRecipe } from "@/store/types";
import { $auth, $recipes } from "@/store/subjects";
import { createRecipe, deleteRecipe, loadRecipes, switchNav, updateRecipe } from "@/store/actions";
import { useDeepSubjectAll } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import { cn } from "@/lib/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-overlay0 text-md">
      <Loader2 size={14} className="animate-spin mr-2" /> Loading editor…
    </div>
  ),
});

interface Draft {
  id?: string;                  // present = edit; missing = create
  slug: string;
  label: string;
  description: string;
  icon: string;
  port: string;                  // string for the form; coerced to int|null on save
  checkScript: string;
  installScript: string;
  uninstallScript: string;
  setupShSnippet: string;
}

const EMPTY_DRAFT: Draft = {
  slug: "",
  label: "",
  description: "",
  icon: "Package",
  port: "",
  checkScript: 'command -v <binary> >/dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"',
  installScript: "set -e\necho 'TODO: install steps'\n",
  uninstallScript: "set -e\necho 'TODO: uninstall steps'\n",
  setupShSnippet: "",
};

function fromRecipe(r: UserRecipe): Draft {
  return {
    id: r.id,
    slug: r.slug,
    label: r.label,
    description: r.description,
    icon: r.icon,
    port: r.port?.toString() ?? "",
    checkScript: r.checkScript,
    installScript: r.installScript,
    uninstallScript: r.uninstallScript,
    setupShSnippet: r.setupShSnippet,
  };
}

export function RecipesPanel() {
  const recipes = useDeepSubjectAll($recipes);
  const [auth] = useSubject($auth);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<"install" | "uninstall" | "check" | "setup">("install");

  const role = auth.user?.role;
  const canAccess = role === "superadmin" || role === "tazcloud";

  useEffect(() => { if (canAccess) loadRecipes(); }, [canAccess]);

  if (!canAccess) {
    return (
      <div className="flex-1 flex items-center justify-center text-overlay0">
        <div className="text-center">
          <p className="text-base">Recipes admin is restricted to super admin and tazcloud users.</p>
          <button onClick={() => switchNav("projects")} className="mt-3 text-blue hover:underline text-md">Back to Projects</button>
        </div>
      </div>
    );
  }

  function save() {
    if (!draft) return;
    const port = draft.port.trim() ? parseInt(draft.port.trim(), 10) : null;
    const payload = {
      slug: draft.slug,
      label: draft.label,
      description: draft.description,
      icon: draft.icon,
      port: Number.isNaN(port) ? null : port,
      checkScript: draft.checkScript,
      installScript: draft.installScript,
      uninstallScript: draft.uninstallScript,
      setupShSnippet: draft.setupShSnippet,
    };
    if (draft.id) updateRecipe(draft.id, payload);
    else createRecipe(payload);
    setDraft(null);
  }

  const editorVal = tab === "install" ? draft?.installScript
    : tab === "uninstall" ? draft?.uninstallScript
    : tab === "check" ? draft?.checkScript
    : draft?.setupShSnippet;

  function setEditorVal(v: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      [tab === "install" ? "installScript" : tab === "uninstall" ? "uninstallScript" : tab === "check" ? "checkScript" : "setupShSnippet"]: v,
    });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4">
        <ViewHeader
          title="Recipes"
          subtitle={<span>scripts that install / check / remove software on a VM</span>}
          actions={
            <>
              <Button size="sm" onClick={loadRecipes} disabled={recipes.loading}>
                <RefreshCw size={14} className={cn("mr-1", recipes.loading && "animate-spin")} /> Refresh
              </Button>
              <Button size="sm" variant="primary" onClick={() => { setDraft({ ...EMPTY_DRAFT }); setTab("install"); }}>
                <Plus size={14} className="mr-1" /> New Recipe
              </Button>
            </>
          }
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {recipes.saveError && (
          <div className="mb-3 text-md text-red bg-red/10 border border-red/30 rounded px-3 py-2 font-mono">
            Save failed: {recipes.saveError}
          </div>
        )}
        {recipes.error && (
          <div className="mb-3 text-md text-red bg-red/10 border border-red/30 rounded px-3 py-2 font-mono">{recipes.error}</div>
        )}

        {!draft && (
          <div className="overflow-x-auto rounded-lg border border-overlay0/20 bg-mantle">
            <table className="w-full text-md font-mono">
              <thead className="bg-surface0 text-overlay1 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Slug</th>
                  <th className="px-3 py-2 font-semibold">Label</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 font-semibold">Port</th>
                  <th className="px-3 py-2 font-semibold w-0">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recipes.list.map((r) => (
                  <tr key={r.id} className="border-t border-overlay0/10 hover:bg-surface0/40">
                    <td className="px-3 py-2 text-text">{r.slug}</td>
                    <td className="px-3 py-2 text-text">{r.label}</td>
                    <td className="px-3 py-2 text-overlay1 truncate max-w-[420px]">{r.description}</td>
                    <td className="px-3 py-2 text-overlay1">{r.port ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setDraft(fromRecipe(r)); setTab("install"); }} className="text-overlay0 hover:text-blue p-1" title="Edit">
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDraft({ ...fromRecipe(r), id: undefined, slug: `${r.slug}-copy`, label: `${r.label} (copy)` })}
                          className="text-overlay0 hover:text-blue text-md px-1"
                          title="Duplicate into a new recipe"
                        >
                          Clone
                        </button>
                        <button
                          onClick={() => { if (confirm(`Delete recipe "${r.slug}"?\n\nNote: built-in recipes are re-seeded on the next manager boot.`)) deleteRecipe(r.id); }}
                          className="text-overlay0 hover:text-red p-1"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft && (
          <div className="flex flex-col gap-3 max-w-6xl">
            <div className="flex items-center justify-between">
              <span className="text-md font-medium text-text">
                {draft.id ? "Edit recipe" : "New recipe"}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setDraft(null)}>
                  <X size={14} className="mr-1" /> Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={save}>
                  <Save size={14} className="mr-1" /> Save
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Slug (URL-safe id, e.g. redis)" v={draft.slug} onChange={(v) => setDraft({ ...draft, slug: v })} />
              <Field label="Label (display)" v={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
              <Field label="Description" v={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} cols={2} />
              <Field label="Icon (lucide name, e.g. Database, Container, Globe)" v={draft.icon} onChange={(v) => setDraft({ ...draft, icon: v })} />
              <Field label="Port (optional)" v={draft.port} onChange={(v) => setDraft({ ...draft, port: v })} />
            </div>

            <div className="flex items-center gap-0 border-b border-surface0 mt-2">
              {(["install", "uninstall", "check", "setup"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-3 py-2 text-md font-medium border-b-2 transition-colors cursor-pointer bg-transparent",
                    tab === t ? "border-blue text-text" : "border-transparent text-overlay0 hover:text-subtext0",
                  )}
                >
                  {t === "install" ? "installScript"
                    : t === "uninstall" ? "uninstallScript"
                    : t === "check" ? "checkScript"
                    : "setupShSnippet"}
                </button>
              ))}
            </div>

            <div className="h-[420px] border border-surface0 rounded-md overflow-hidden">
              <MonacoEditor
                height="100%"
                language="shell"
                theme="vs-dark"
                value={editorVal}
                onChange={(v) => setEditorVal(v ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
              />
            </div>
            <p className="text-xs text-overlay0">
              Scripts have access to <code className="font-mono text-overlay1">log "msg"</code> (timestamped output)
              and <code className="font-mono text-overlay1">wait_apt</code> (blocks for dpkg/apt locks with heartbeat).
              They&apos;re auto-injected by the runner.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, v, onChange, cols = 1 }: { label: string; v: string; onChange: (v: string) => void; cols?: 1 | 2 }) {
  return (
    <div className={cn("flex flex-col gap-1", cols === 2 && "col-span-2")}>
      <label className="text-md text-overlay0">{label}</label>
      <input
        type="text"
        value={v}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="bg-mantle border border-surface0 rounded-md px-2.5 py-1.5 text-md text-text outline-none font-mono focus:border-blue"
      />
    </div>
  );
}
