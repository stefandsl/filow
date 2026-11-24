import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LANGS } from "@filow/core";

const require = createRequire(import.meta.url);
const desktopDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const welcomeHtml = path.join(desktopDir, "welcome.html");

type LayoutIssue = {
  lang: string;
  theme: string;
  size: string;
  step: string;
  problems: string[];
};

/**
 * Spawns one hidden Electron process to render the real welcome.html + vendor bundle across
 * all five languages, both themes, and every spec viewport (1000x720, 975x705, 840x580,
 * framed-840x580 inner size 824x541, and 200% zoom). Uses a disposable temp user-data-dir.
 */
function measureWelcomeLayout(): { issues: LayoutIssue[]; zoomProblems: string[]; a11yProblems: string[] } {
  const electronExe = require("electron") as string;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filow-welcome-layout-"));
  const userDataDir = path.join(tmpDir, "profile");
  const preloadPath = path.join(tmpDir, "mock-preload.js");
  const runnerPath = path.join(tmpDir, "runner.js");

  fs.writeFileSync(preloadPath, `
const { contextBridge, ipcRenderer } = require("electron");
let state = {
  revision: 1,
  lang: "en",
  resolvedLang: "en",
  theme: "dark",
  resolvedTheme: "dark",
  followSystemAccent: false,
  accentColor: null,
  startup: { supported: true, requested: false, enabled: false, status: "disabled" },
  accentSupported: true,
};
const listeners = new Set();
ipcRenderer.on("mock:setState", (_e, patch) => {
  state = { ...state, ...patch, revision: state.revision + 1 };
  for (const fn of listeners) fn(state);
});
contextBridge.exposeInMainWorld("filowWelcome", {
  getPreferences: async () => state,
  updatePreferences: async (patch) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    for (const fn of listeners) fn(state);
    return { ok: true, state };
  },
  onPreferencesChanged: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  complete: async () => ({ ok: true, state }),
  context: async () => ({ firstRun: true, askSetup: true }),
  setupOffer: async () => ({
    ask: true, ready: false, downloadGb: 2.5, needsOllama: true,
    models: ["nemotron-streaming"], device: "pc", ramGb: 16, online: true, profile: "Balanced",
  }),
  chooseSetup: async () => ({ ok: true }),
  openMicSettings: () => {},
});
window.addEventListener("filow:hydrated", () => ipcRenderer.send("mock:hydrated"), { once: true });
`, "utf8");

  fs.writeFileSync(runnerPath, `
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

app.commandLine.appendSwitch("disable-gpu");
app.setPath("userData", ${JSON.stringify(userDataDir)});

const LANGS = ${JSON.stringify([...LANGS])};
const THEMES = ["dark", "light"];
const SIZES = [
  { name: "1000x720", w: 1000, h: 720 },
  { name: "975x705", w: 975, h: 705 },
  { name: "840x580", w: 840, h: 580 },
  { name: "824x541", w: 824, h: 541 },
];

async function flushLayout(wc) {
  await wc.executeJavaScript("new Promise(r => setTimeout(() => { void document.body.offsetHeight; r(); }, 0))");
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 720, useContentSize: true, show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
      preload: ${JSON.stringify(preloadPath)},
    },
  });
  const hydrated = new Promise(resolve => ipcMain.once("mock:hydrated", resolve));
  await win.loadFile(${JSON.stringify(welcomeHtml)});
  await hydrated;
  await flushLayout(win.webContents);

  const issues = [];
  const a11yProblems = [];
  const zoomProblems = [];

  for (const size of SIZES) {
    win.setContentSize(size.w, size.h);
    await flushLayout(win.webContents);
    for (const theme of THEMES) {
      for (const lang of LANGS) {
        win.webContents.send("mock:setState", { lang, resolvedLang: lang, theme, resolvedTheme: theme });
        await flushLayout(win.webContents);

        for (const step of ["language", "intro"]) {
          const problems = await win.webContents.executeJavaScript(\`(() => {
            const targetStep = \${JSON.stringify(step)};
            const current = document.querySelector(".step:not([hidden])")?.dataset.step;
            if (current !== targetStep) {
              if (targetStep === "intro") document.querySelector("#start").click();
              else document.querySelector("#back").click();
            }
            void document.body.offsetHeight;
            const out = [];
            const brand = document.querySelector(".brand");
            const panel = document.querySelector(".panel");
            const brandRect = brand.getBoundingClientRect();
            const footer = brand.querySelector("footer");
            const stepper = brand.querySelector("#stepper");
            const copy = brand.querySelector(".brand-copy");
            const startBtn = document.querySelector("#start");

            if (brand.scrollHeight > brand.clientHeight + 1) {
              out.push(\\\`brand vertical overflow: \\\${brand.scrollHeight} > \\\${brand.clientHeight}\\\`);
            }
            if (brand.scrollWidth > brand.clientWidth + 1) {
              out.push(\\\`brand horizontal overflow: \\\${brand.scrollWidth} > \\\${brand.clientWidth}\\\`);
            }
            const features = [...brand.querySelectorAll(".features li")];
            if (features.length < 7) out.push(\\\`brand features count: \\\${features.length}\\\`);
            for (const li of features) {
              const r = li.getBoundingClientRect();
              if (r.height === 0 || getComputedStyle(li).display === "none") out.push("hidden brand feature");
              if (r.bottom > brandRect.bottom + 1) out.push("brand feature clipped vertically");
              if (r.right > brandRect.right + 1) out.push("brand feature clipped horizontally");
            }
            const copyRect = copy.getBoundingClientRect();
            const stepperRect = stepper.getBoundingClientRect();
            const footerRect = footer.getBoundingClientRect();
            if (copyRect.bottom > stepperRect.top + 1) out.push(\\\`brand-copy overlaps stepper: \\\${Math.round(copyRect.bottom)} > \\\${Math.round(stepperRect.top)}\\\`);
            if (stepperRect.bottom > footerRect.top + 1) out.push(\\\`stepper overlaps footer: \\\${Math.round(stepperRect.bottom)} > \\\${Math.round(footerRect.top)}\\\`);
            if (footerRect.bottom > brandRect.bottom + 1) out.push(\\\`footer clipped: \\\${Math.round(footerRect.bottom)} > \\\${Math.round(brandRect.bottom)}\\\`);

            if (panel.scrollHeight > panel.clientHeight + 1) {
              out.push(\\\`panel vertical scrollbar: \\\${panel.scrollHeight} > \\\${panel.clientHeight}\\\`);
            }
            if (panel.scrollWidth > panel.clientWidth + 1) {
              out.push(\\\`panel horizontal overflow: \\\${panel.scrollWidth} > \\\${panel.clientWidth}\\\`);
            }
            const startRect = startBtn.getBoundingClientRect();
            if (startRect.bottom > window.innerHeight + 1) out.push(\\\`primary CTA below viewport: \\\${Math.round(startRect.bottom)} > \\\${window.innerHeight}\\\`);

            if (targetStep === "intro") {
              const guides = [...document.querySelectorAll('[data-step="intro"] .guide-list li')];
              if (guides.length < 7) out.push(\\\`guide list count: \\\${guides.length}\\\`);
              const actionsRect = document.querySelector(".actions").getBoundingClientRect();
              for (const li of guides) {
                const r = li.getBoundingClientRect();
                if (r.height === 0) out.push("hidden guide item");
                if (r.bottom > actionsRect.top + 1) out.push("guide item overlaps actions");
              }
            }
            return out;
          })()\`);
          if (problems.length > 0) issues.push({ lang, theme, size: size.name, step, problems });
        }

        // Return to language step for the next iteration.
        await win.webContents.executeJavaScript('document.querySelector("#back").click()');
        await flushLayout(win.webContents);
      }
    }
  }

  // Check 200% zoom at 1000x720 (effective 500x360 viewport): no horizontal overflow, primary CTA visible.
  win.setContentSize(1000, 720);
  win.webContents.setZoomFactor(2);
  win.webContents.send("mock:setState", { lang: "it", resolvedLang: "it", theme: "dark", resolvedTheme: "dark" });
  await flushLayout(win.webContents);
  for (const step of ["language", "intro"]) {
    const zp = await win.webContents.executeJavaScript(\`(() => {
      const targetStep = \${JSON.stringify(step)};
      const current = document.querySelector(".step:not([hidden])")?.dataset.step;
      if (current !== targetStep) {
        if (targetStep === "intro") document.querySelector("#start").click();
        else document.querySelector("#back").click();
      }
      void document.body.offsetHeight;
      const out = [];
      const panel = document.querySelector(".panel");
      const startRect = document.querySelector("#start").getBoundingClientRect();
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(\\\`\\\${targetStep}: root horizontal overflow at 200%\\\`);
      if (panel.scrollWidth > panel.clientWidth + 1) out.push(\\\`\\\${targetStep}: panel horizontal overflow at 200%\\\`);
      if (startRect.bottom > window.innerHeight + 1) out.push(\\\`\\\${targetStep}: primary CTA clipped at 200%\\\`);
      return out;
    })()\`);
    zoomProblems.push(...zp);
  }
  win.webContents.setZoomFactor(1);

  // Check keyboard focus and accessible names (Narrator).
  const a11y = await win.webContents.executeJavaScript(\`(() => {
    const out = [];
    const features = document.querySelector(".features");
    if (!features?.getAttribute("aria-label")?.trim()) out.push("features list missing aria-label");
    const guideList = document.querySelector('[data-step="intro"] .guide-list');
    if (!guideList?.getAttribute("aria-label")?.trim()) out.push("guide list missing aria-label");
    if (document.activeElement?.id !== "h-intro") out.push(\\\`expected focus on h-intro, got \\\${document.activeElement?.id}\\\`);
    document.querySelector("#back").click();
    if (document.activeElement?.id !== "h-language") out.push(\\\`expected focus on h-language, got \\\${document.activeElement?.id}\\\`);
    return out;
  })()\`);
  a11yProblems.push(...a11y);

  process.stdout.write("LAYOUT_JSON:" + JSON.stringify({ issues, zoomProblems, a11yProblems }) + "\\n");
  app.exit(0);
}).catch(err => {
  console.error(err);
  app.exit(1);
});
`, "utf8");

  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const raw = execFileSync(electronExe, [runnerPath], {
      env,
      encoding: "utf8",
      timeout: 25_000,
    });
    const line = raw.split(/\r?\n/).find(l => l.startsWith("LAYOUT_JSON:"));
    if (!line) throw new Error(`No layout output from Electron:\n${raw}`);
    return JSON.parse(line.slice("LAYOUT_JSON:".length));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("welcome window layout across all languages, themes and sizes", () => {
  // Explicit 30 s timeout (R31): spawns one Electron instance to measure 5 languages x 2 themes x 4 sizes + 200% zoom.
  it("fits cleanly with no brand clipping, no vertical scrollbar at 1000x720..840x580, and works at 200% scale", () => {
    const { issues, zoomProblems, a11yProblems } = measureWelcomeLayout();
    expect(issues).toEqual([]);
    expect(zoomProblems).toEqual([]);
    expect(a11yProblems).toEqual([]);
  }, 30_000);
});
