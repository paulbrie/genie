import { DeepSubject } from "subjecto";
import type { RecipesState } from "../types/recipes";

export const $recipes = new DeepSubject<RecipesState>({
  list: [],
  loading: false,
  error: null,
  saveError: null,
});
