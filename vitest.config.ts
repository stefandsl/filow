import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app imports its own modules as "@/…" (tsconfig paths); vitest needs the same alias.
  resolve: { alias: { "@": path.resolve(__dirname, "apps/web") } },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["apps/cloud/**/*.test.ts", "apps/web/components/**/*.test.tsx", "apps/desktop/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/server/src/**/*.test.ts", "apps/powerpoint/src/**/*.test.ts", "apps/browser/src/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/web/app/**/*.test.ts", "tools/autoloop/**/*.test.ts"],
    environment: "node",
    // The default 5 s is too tight for a two-core CI runner: a first call that really probes the hardware,
    // or a property test beside the whole suite, crossed it there while taking a fraction of a second here.
    testTimeout: 20_000,
    // `npm run test:coverage`. Thresholds are a ratchet at the measured level (2026-11-09: lines 38.39,
    // branches 37.07, functions 36.95): coverage may only go up. Target: docs/autoloop/STANDARDS.md TST-01.
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**", "apps/web/lib/**", "apps/desktop/*.js"],
      exclude: ["**/*.test.*"],
      reportsDirectory: "tmp/coverage",
      thresholds: { lines: 38, branches: 37, functions: 36 },
    },
  },
});
