import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/ws", () => ({
  wsSend: vi.fn(),
}));

import { loadRecipes, createRecipe, updateRecipe, deleteRecipe } from "./recipes";
import { $recipes } from "../subjects/recipes";
import { wsSend } from "@/lib/ws";

beforeEach(() => {
  $recipes.next({ list: [], loading: false, error: null, saveError: null });
  vi.mocked(wsSend).mockClear();
});

describe("loadRecipes", () => {
  it("marks loading and sends recipes:list with empty payload", () => {
    handlerFreshFirst();
    loadRecipes();

    expect($recipes.getValue().loading).toBe(true);
    expect($recipes.getValue().error).toBeNull();
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("recipes:list", {});
  });

  it("clears a previous error when retried", () => {
    $recipes.getValue().error = "previous failure";
    loadRecipes();
    expect($recipes.getValue().error).toBeNull();
  });
});

describe("createRecipe", () => {
  it("sends recipes:create with the input payload", () => {
    const input = { slug: "redis", label: "Redis", installScript: "apt-get install redis" };
    createRecipe(input);

    expect(wsSend).toHaveBeenCalledExactlyOnceWith("recipes:create", input);
  });

  it("clears any previous saveError optimistically", () => {
    $recipes.getValue().saveError = "slug already exists";
    createRecipe({ slug: "new" });
    expect($recipes.getValue().saveError).toBeNull();
  });
});

describe("updateRecipe", () => {
  it("merges id into the payload sent to the server", () => {
    updateRecipe("r-1", { label: "Renamed" });
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("recipes:update", { id: "r-1", label: "Renamed" });
  });

  it("clears saveError before sending", () => {
    $recipes.getValue().saveError = "earlier failure";
    updateRecipe("r-1", {});
    expect($recipes.getValue().saveError).toBeNull();
  });
});

describe("deleteRecipe", () => {
  it("sends recipes:delete with just the id", () => {
    deleteRecipe("r-1");
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("recipes:delete", { id: "r-1" });
  });
});

// Defensive guard: subject must be in a clean state before each test.
// (Mostly a sanity check that beforeEach is actually running.)
function handlerFreshFirst() {
  expect($recipes.getValue()).toEqual({ list: [], loading: false, error: null, saveError: null });
}
