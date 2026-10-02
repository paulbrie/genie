import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest config for store unit tests. Kept separate from next.config (which
// stays Webpack/Turbopack-driven). Mirrors the `@/*` path alias from
// tsconfig.json so test files can import store modules the same way
// components do.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    // Avoid loading Playwright's spec files (under tests/ at the package root,
    // and using *.spec.ts).
    exclude: ["node_modules", "dist", ".next", "tests/**"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
