import { DeepSubject } from "subjecto";
import type { KnowledgeState } from "../types/knowledge";

export const $knowledge = new DeepSubject<KnowledgeState>({
  files: [],
  selectedPath: null,
  loading: false,
  loaded: false,
  error: null,
  saveError: null,
});
