import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./vitest.globalSetup.ts"],
    // Service tests share one test DB and truncate between tests, so files
    // must run sequentially to avoid cross-file data races.
    fileParallelism: false,
  },
});
