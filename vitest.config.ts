import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Bound concurrent schema compilation and local HTTP runtimes on dev hosts.
    maxWorkers: 4,
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "services/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
