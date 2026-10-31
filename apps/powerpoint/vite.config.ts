import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Office add-ins must be served over HTTPS. `npx office-addin-dev-certs install`
// puts a trusted localhost certificate in ~/.office-addin-dev-certs; use it when present.
function devCerts() {
  const dir = path.join(os.homedir(), ".office-addin-dev-certs");
  const key = path.join(dir, "localhost.key");
  const cert = path.join(dir, "localhost.crt");
  return fs.existsSync(key) && fs.existsSync(cert) ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } : undefined;
}

export default defineConfig({
  plugins: [react()],
  // Production: served by apps/web at /powerpoint/ (same origin as the API and relay).
  base: "/powerpoint/",
  build: { outDir: path.resolve(__dirname, "../web/public/powerpoint"), emptyOutDir: true },
  server: {
    port: 3000,
    https: devCerts(),
    // Dev: the pane runs on https://localhost:3000 and talks to the local servers as if same-origin.
    proxy: {
      "/api/session": { target: "http://127.0.0.1:4748", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4748", ws: true },
      "/api": { target: "http://127.0.0.1:4747", changeOrigin: true },
    },
  },
});
