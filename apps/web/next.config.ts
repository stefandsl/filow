import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output lets the desktop app and the Debian deploy run the
  // server with only .next/standalone + .next/static (no node_modules needed).
  output: "standalone",
  // Monorepo: trace files from the repo root so workspace packages are included.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@intelliprompter/core", "@intelliprompter/stt", "@intelliprompter/client"],
};

export default nextConfig;
