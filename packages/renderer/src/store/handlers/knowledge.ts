import { batch } from "subjecto";
import { $knowledge } from "../subjects/knowledge";
import { loadKnowledge } from "../actions/knowledge";
import type { KnowledgeFile } from "../types/knowledge";
import type { HandlerMap } from "./types";

// Wire format from packages/manager/src/handlers/knowledge-handler.ts:
//   knowledge:list       → { files: KnowledgeFile[], error?: string }
//   knowledge:upserted   → { file: KnowledgeFile }
//   knowledge:deleted    → { id: string }
//   knowledge:error      → { message: string }
//   knowledge:list:stale → {} (broadcast — refetch)

export const handlers: HandlerMap = {
  "knowledge:list": (payload) => {
    batch(() => {
      const v = $knowledge.getValue();
      const files = (payload.files as KnowledgeFile[]) || [];
      v.files = files;
      v.error = payload.error ?? null;
      v.loading = false;
      v.loaded = true;
      // Keep the current selection if it still exists; otherwise open a sensible
      // default (a top-level index.md, then the first file).
      const stillThere = v.selectedPath && files.some((f) => f.path === v.selectedPath);
      if (!stillThere) {
        v.selectedPath = files.find((f) => f.path === "index.md")?.path ?? files[0]?.path ?? null;
      }
    });
  },

  "knowledge:upserted": (payload) => {
    batch(() => {
      const v = $knowledge.getValue();
      const file = payload.file as KnowledgeFile;
      const idx = v.files.findIndex((f) => f.id === file.id);
      if (idx >= 0) v.files[idx] = file;
      else v.files.push(file);
      v.files.sort((a, b) => a.path.localeCompare(b.path));
      v.selectedPath = file.path;
      v.saveError = null;
    });
  },

  "knowledge:deleted": (payload) => {
    batch(() => {
      const v = $knowledge.getValue();
      v.files = v.files.filter((f) => f.id !== payload.id);
      if (v.selectedPath && !v.files.some((f) => f.path === v.selectedPath)) {
        v.selectedPath = v.files[0]?.path ?? null;
      }
    });
  },

  "knowledge:error": (payload) => {
    $knowledge.getValue().saveError = payload.message ?? "Unknown error";
  },

  // Broadcast after any mutation by any superadmin — refetch so all panels stay
  // in sync. Cheap because the bundle is small.
  "knowledge:list:stale": (_payload) => {
    loadKnowledge();
  },
};
