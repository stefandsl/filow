import path from "node:path";
import { defineConfig } from "vitest/config";

// Only for the translation bench (bench.ts): the same alias as the app, one file, no time limit of its own.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "../../apps/web") } },
  test: { include: ["tools/translate-bench/bench.ts"], environment: "node", root: path.resolve(__dirname, "../..") },
});
