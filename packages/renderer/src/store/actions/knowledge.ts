import { batch } from "subjecto";
import { wsSend } from "@/lib/ws";
import { $knowledge } from "../subjects/knowledge";

/** Fetch the knowledge bundle from the manager. Server replies with
 *  `knowledge:list` → { files, error? }. Superadmin-only. */
export function loadKnowledge(): void {
  batch(() => {
    const v = $knowledge.getValue();
    v.loading = true;
    v.error = null;
  });
  wsSend("knowledge:list", {});
}

/** Open a knowledge doc in the reader pane. */
export function selectKnowledgeFile(path: string): void {
  $knowledge.getValue().selectedPath = path;
}

/** Create a new doc. Server replies `knowledge:upserted` or `knowledge:error`. */
export function createKnowledge(input: { path: string; title?: string; content: string }): void {
  $knowledge.getValue().saveError = null;
  wsSend("knowledge:create", input);
}

/** Update an existing doc by id. */
export function updateKnowledge(id: string, patch: { path?: string; title?: string; content?: string }): void {
  $knowledge.getValue().saveError = null;
  wsSend("knowledge:update", { id, ...patch });
}

/** Delete a doc by id. */
export function deleteKnowledge(id: string): void {
  wsSend("knowledge:delete", { id });
}

/** Clear a stale save error (e.g. when opening/closing the editor). */
export function clearKnowledgeSaveError(): void {
  $knowledge.getValue().saveError = null;
}
