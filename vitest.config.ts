import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app imports its own modules as "@/…" (tsconfig paths); vitest needs the same alias.
  resolve: { alias: { "@": path.resolve(__dirname, "apps/web") } },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/server/src/**/*.test.ts", "apps/powerpoint/src/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/web/app/**/*.test.ts"],
    environment: "node",
  },
});
