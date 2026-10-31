import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output lets the desktop app and the Debian deploy run the
  // server with only .next/standalone + .next/static (no node_modules needed).
  output: "standalone",
};

export default nextConfig;
