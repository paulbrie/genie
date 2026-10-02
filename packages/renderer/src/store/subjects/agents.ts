import { DeepSubject } from "subjecto";
import type { AgentsState } from "../types/agents";

export const $agents = new DeepSubject<AgentsState>({
  list: [],
  loading: false,
  error: null,
  saveError: null,
  runs: {},
});
