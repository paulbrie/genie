import { describe, it, expect, beforeEach, vi } from "vitest";
import { handlers } from "./recipes";
import { $recipes } from "../subjects/recipes";
import type { UserRecipe, RecipesState } from "../types/recipes";

// `recipes:list:stale` fires loadRecipes(), which wsSends. Stub it so tests
// don't try to open a websocket.
vi.mock("../actions/recipes", () => ({
  loadRecipes: vi.fn(),
}));
import { loadRecipes } from "../actions/recipes";

const INITIAL: RecipesState = { list: [], loading: false, error: null, saveError: null };

function makeRecipe(overrides: Partial<UserRecipe> = {}): UserRecipe {
  return {
    id: "r-1",
    slug: "nodejs",
    label: "Node.js",
    description: "Node.js LTS",
    icon: "Server",
    port: null,
    checkScript: "command -v node >/dev/null && echo INSTALLED || echo NOT_INSTALLED",
    installScript: "apt-get install -y nodejs",
    uninstallScript: "apt-get remove -y nodejs",
    setupShSnippet: "",
    commands: [],
    options: [],
    createdBy: null,
    createdAt: "2026-05-16T00:00:00Z",
    updatedAt: "2026-05-16T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  // Reset the singleton DeepSubject — handlers are global state mutations.
  $recipes.next({ list: [], loading: false, error: null, saveError: null });
  vi.mocked(loadRecipes).mockClear();
});

describe("recipes:list", () => {
  it("replaces the list and clears loading", () => {
    $recipes.getValue().loading = true;
    const recipes = [makeRecipe({ id: "a" }), makeRecipe({ id: "b", slug: "redis" })];

    handlers["recipes:list"]({ recipes });

    const v = $recipes.getValue();
    expect(v.list.map((r) => r.id)).toEqual(["a", "b"]);
    expect(v.loading).toBe(false);
    expect(v.error).toBeNull();
  });

  it("propagates the server's error string", () => {
    handlers["recipes:list"]({ recipes: [], error: "DB unreachable" });
    expect($recipes.getValue().error).toBe("DB unreachable");
  });

  it("treats a missing recipes field as an empty list", () => {
    $recipes.getValue().list = [makeRecipe()];
    handlers["recipes:list"]({});
    expect($recipes.getValue().list).toEqual([]);
  });
});

describe("recipes:upserted", () => {
  it("appends a new recipe when no matching id exists", () => {
    handlers["recipes:upserted"]({ recipe: makeRecipe({ id: "new-1" }) });
    const list = $recipes.getValue().list;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("new-1");
  });

  it("replaces in place when the id matches", () => {
    $recipes.getValue().list = [
      makeRecipe({ id: "r-1", label: "Old label" }),
      makeRecipe({ id: "r-2" }),
    ];

    handlers["recipes:upserted"]({ recipe: makeRecipe({ id: "r-1", label: "New label" }) });

    const list = $recipes.getValue().list;
    expect(list).toHaveLength(2);
    expect(list[0].label).toBe("New label");
    expect(list[1].id).toBe("r-2");
  });

  it("clears any previous saveError", () => {
    $recipes.getValue().saveError = "previous failure";
    handlers["recipes:upserted"]({ recipe: makeRecipe() });
    expect($recipes.getValue().saveError).toBeNull();
  });
});

describe("recipes:deleted", () => {
  it("removes the matching recipe", () => {
    $recipes.getValue().list = [
      makeRecipe({ id: "keep-1" }),
      makeRecipe({ id: "drop-me" }),
      makeRecipe({ id: "keep-2" }),
    ];

    handlers["recipes:deleted"]({ id: "drop-me" });

    expect($recipes.getValue().list.map((r) => r.id)).toEqual(["keep-1", "keep-2"]);
  });

  it("is a no-op when the id is not present", () => {
    $recipes.getValue().list = [makeRecipe({ id: "r-1" })];
    handlers["recipes:deleted"]({ id: "does-not-exist" });
    expect($recipes.getValue().list).toHaveLength(1);
  });
});

describe("recipes:error", () => {
  it("stores the message in saveError", () => {
    handlers["recipes:error"]({ message: "slug already exists" });
    expect($recipes.getValue().saveError).toBe("slug already exists");
  });

  it("falls back to a default when no message is provided", () => {
    handlers["recipes:error"]({});
    expect($recipes.getValue().saveError).toBe("Unknown error");
  });
});

describe("recipes:list:stale", () => {
  it("triggers loadRecipes()", () => {
    handlers["recipes:list:stale"]({});
    expect(loadRecipes).toHaveBeenCalledTimes(1);
  });
});
