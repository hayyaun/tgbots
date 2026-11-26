import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    env: { DEV: "" },
    maxWorkers: 2,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      include: ["src/inmankist/**/*.ts", "src/shared/i18n/language.ts"],
      exclude: ["**/json/**", "**/deities.ts", "**/personalities.ts", "**/descriptions.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
