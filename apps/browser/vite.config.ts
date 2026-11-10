import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Three entries: the side panel (React page), the background service worker and the content
// script. The content script must be a single classic file (no shared chunks, no ESM), so it is
// built as its own IIFE in scripts/pack.js; here it is excluded from code splitting by being
// listed as an input with inlineDynamicImports via the manualChunks override below.
export default defineConfig({
  plugins: [react()],
  // The outbound notice and signal are the web app's own (apps/web/components/RemoteOutbound.tsx), imported as "@/...".
  resolve: { alias: [{ find: /^@\//, replacement: `${path.resolve(__dirname, "../web")}/` }], dedupe: ["react", "react-dom"] },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
        background: path.resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
