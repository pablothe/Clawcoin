import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/test-guard.ts"],
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
