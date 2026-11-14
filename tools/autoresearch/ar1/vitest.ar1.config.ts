// FIXED: part of the AR-1 evaluator. Runs only the measurement worker, never the normal suite.
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "../../../apps/web") } },
  test: { include: ["tools/autoresearch/ar1/measure.ar1.ts"], environment: "node", testTimeout: 30 * 60_000, reporters: ["dot"] },
});
