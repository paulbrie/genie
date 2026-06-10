import { DeepSubject } from "subjecto";
import type { ClaudePluginsState } from "../types/claude-plugins";

export const $claudePlugins = new DeepSubject<ClaudePluginsState>({
  list: [],
  loading: false,
  error: null,
  saveError: null,
});
