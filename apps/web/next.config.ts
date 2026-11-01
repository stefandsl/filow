import path from "node:path";
import type { NextConfig } from "next";

// Rebrand compatibility: a .env written for Intelliprompter keeps working (INTELLIPROMPTER_* -> FILOW_*).
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("INTELLIPROMPTER_") && v !== undefined && !("FILOW_" + k.slice(16) in process.env)) process.env["FILOW_" + k.slice(16)] = v;
}

const nextConfig: NextConfig = {
  // Standalone output lets the desktop app and the Debian deploy run the
  // server with only .next/standalone + .next/static (no node_modules needed).
  output: "standalone",
  // Monorepo: trace files from the repo root so workspace packages are included.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@filow/core", "@filow/stt", "@filow/client", "@filow/ui"],
};

export default nextConfig;
