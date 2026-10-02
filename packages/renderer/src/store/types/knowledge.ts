/** One markdown doc from the knowledge bundle (Genie concepts), stored in the
 *  DB and editable by superadmins. */
export interface KnowledgeFile {
  id: string;
  /** Forward-slash tree path, e.g. "recipes/recipe.md". Unique; used by links. */
  path: string;
  /** First markdown H1, or the basename if none. */
  title: string;
  content: string;
}

export interface KnowledgeState {
  files: KnowledgeFile[];
  /** Path of the currently open file, or null for none selected. */
  selectedPath: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Last create/update/delete error, surfaced in the editor. */
  saveError: string | null;
}
