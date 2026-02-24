import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/test-guard.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**"],
    testTimeout: 30_000,
  },
});
