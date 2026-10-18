import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "test/**/*.test.ts"]
  }
});
