// Lint for the whole monorepo (STANDARDS TST-05). `npm run lint` must stay at 0 errors and 0 warnings.
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/.next/**", "**/dist/**", "**/out/**", "**/vendor/**", "**/*.d.ts",
      "apps/web/public/**", "**/*.min.js", "**/*.min.mjs",
      "release*/**", "tmp/**", "output/**", "design/**", "graphify-out/**", "coverage/**",
      // Agent worktrees live under .claude/worktrees: full copies of the repo with work in progress. Flat
      // config does not skip dot folders, so without this the gate passed or failed with their half-written files.
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_name` marks a parameter or binding that is unused on purpose.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // `let t; const done = () => clearInterval(t); t = setInterval(..., done)`: read before assign is the point.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
    },
  },
  // Electron main process, preloads, workers and build scripts: CommonJS on Node.
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // `const crypto = require("node:crypto")` deliberately shadows the Web Crypto global.
      "no-redeclare": ["error", { builtinGlobals: false }],
    },
  },
  // Test doubles stand in for Electron, sockets and workers; typing them fully adds nothing.
  { files: ["**/*.test.ts", "**/*.test.tsx"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  // Preloads and the welcome page also run in a browser context.
  {
    files: ["apps/desktop/*preload.js", "apps/desktop/welcome.ts", "apps/desktop/splash*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  { files: ["**/*.mjs"], languageOptions: { sourceType: "module", globals: { ...globals.node } } },
  { files: ["apps/cloud/public/*.mjs"], languageOptions: { sourceType: "module", globals: { ...globals.browser } } },
  // The browser extension runs in Chrome.
  { files: ["apps/browser/src/**/*.ts"], languageOptions: { globals: { ...globals.browser, chrome: "readonly" } } },
  // The PowerPoint task pane runs in Office's browser.
  { files: ["apps/powerpoint/src/**/*.{ts,tsx}"], languageOptions: { globals: { ...globals.browser, Office: "readonly", PowerPoint: "readonly" } } },
  // React apps: hooks rules everywhere React is used, Next rules in the web app.
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}", "packages/stt/**/*.{ts,tsx}", "apps/powerpoint/**/*.{ts,tsx}", "apps/browser/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Every <img> here shows a data: or blob: URL made at runtime (QR codes, screen thumbnails,
      // photos); next/image cannot optimise those, and the app is served from this PC.
      "@next/next/no-img-element": "off",
    },
  },
);
