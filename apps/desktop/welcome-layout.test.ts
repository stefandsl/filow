import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LANGS } from "@filow/core";
import { captions } from "../../scripts/intro-captions.mjs";

const require = createRequire(import.meta.url);
const desktopDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repoRoot = path.resolve(desktopDir, "..", "..");
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
 * framed-840x580 inner size 824x541, and 200% zoom). Uses a repo-local gitignored tmp folder
 * (never os.tmpdir() on C:).
 */
function measureWelcomeLayout(): {
  issues: LayoutIssue[];
  zoomProblems: string[];
  a11yProblems: string[];
  shortcutProblems: string[];
  guideRevealProblems: string[];
} {
  const electronExe = require("electron") as string;
  const tmpRoot = path.join(repoRoot, "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "welcome-layout-"));
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
let contextData = {
  firstRun: true,
  askSetup: true,
  shortcuts: { talk: "Control + Option", dictation: "Control + Command" },
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
  context: async () => contextData,
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
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.setPath("userData", ${JSON.stringify(userDataDir)});

const LANGS = ${JSON.stringify([...LANGS])};
const FIRST_CUES = ${JSON.stringify(Object.fromEntries(Object.entries(captions).map(([k, v]) => [k, v[0]])))};
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

async function waitViewport(wc, expectedW, expectedH) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const ok = await wc.executeJavaScript(\`Math.abs(window.innerWidth - \${expectedW}) <= 2 && Math.abs(window.innerHeight - \${expectedH}) <= 2\`);
    if (ok) break;
    await new Promise(r => setTimeout(r, 20));
  }
  await flushLayout(wc);
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
  const shortcutProblems = [];
  const guideRevealProblems = [];

  for (const size of SIZES) {
    win.setContentSize(size.w, size.h);
    await waitViewport(win.webContents, size.w, size.h);
    for (const theme of THEMES) {
      for (const lang of LANGS) {
        win.webContents.send("mock:setState", { lang, resolvedLang: lang, theme, resolvedTheme: theme });
        await flushLayout(win.webContents);

        for (const step of ["language", "intro"]) {
          const problems = await win.webContents.executeJavaScript(\`(() => {
            const targetStep = \${JSON.stringify(step)};
            const sizeName = \${JSON.stringify(size.name)};
            const langCode = \${JSON.stringify(lang)};
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
            const tagline = brand.querySelector(".tagline");
            const activeH1 = document.querySelector(".step:not([hidden]) h1");

            // Check Japanese rendered line breaks against Intl.Segmenter word boundaries,
            // katakana compounds, and orphan trailing particles/inflections.
            const jaSegmenter = langCode === "ja" ? new Intl.Segmenter("ja", { granularity: "word" }) : null;
            function checkJaWordSplits(el, label) {
              if (!jaSegmenter || !el) return;
              const style = getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden") return;
              const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
              const chars = [];
              let fullText = "";
              let node;
              while ((node = walker.nextNode())) {
                const text = node.nodeValue || "";
                for (let i = 0; i < text.length; i++) {
                  chars.push({ node, offset: i, ch: text[i] });
                }
                fullText += text;
              }
              if (!fullText.trim()) return;
              const lines = [];
              const range = document.createRange();
              for (let i = 0; i < chars.length; i++) {
                if (/\\s/.test(chars[i].ch)) continue;
                range.setStart(chars[i].node, chars[i].offset);
                range.setEnd(chars[i].node, chars[i].offset + 1);
                const r = range.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                const lastLine = lines[lines.length - 1];
                if (!lastLine || Math.abs(r.top - lastLine.top) > Math.max(4, r.height * 0.4)) {
                  lines.push({ top: r.top, startIdx: i });
                }
              }
              if (lines.length <= 1) return;
              const segments = [...jaSegmenter.segment(fullText)];
              const kata = /[\\u30A1-\\u30FA\\u30FC]/;
              const orphanEnd = /^[。、」）！？すたてるなえま]/;
              const jaChar = /[\\u3040-\\u30FF\\u4E00-\\u9FFF]/;
              for (let l = 1; l < lines.length; l++) {
                const idx = lines[l].startIdx;
                const splitSeg = segments.find(s => s.isWordLike && s.index < idx && idx < s.index + s.segment.length);
                if (splitSeg) {
                  out.push(\\\`JA word split in \\\${label}: "\\\${splitSeg.segment}" broken at "\\\${fullText.slice(Math.max(0, idx - 3), idx)}/\\\${fullText.slice(idx, idx + 3)}"\\\`);
                  continue;
                }
                const prevCh = fullText[idx - 1] || "";
                const nextCh = fullText[idx] || "";
                if (kata.test(prevCh) && kata.test(nextCh)) {
                  out.push(\\\`JA katakana split in \\\${label}: "\\\${fullText.slice(Math.max(0, idx - 3), idx)}/\\\${fullText.slice(idx, idx + 3)}"\\\`);
                  continue;
                }
                if (jaChar.test(prevCh) && orphanEnd.test(nextCh)) {
                  out.push(\\\`JA phrase/inflection split in \\\${label}: "\\\${fullText.slice(Math.max(0, idx - 3), idx)}/\\\${fullText.slice(idx, idx + 3)}"\\\`);
                }
              }
            }

            if (brand.scrollHeight > brand.clientHeight + 1) {
              out.push(\\\`brand vertical overflow: \\\${brand.scrollHeight} > \\\${brand.clientHeight}\\\`);
            }
            if (brand.scrollWidth > brand.clientWidth + 1) {
              out.push(\\\`brand horizontal overflow: \\\${brand.scrollWidth} > \\\${brand.clientWidth}\\\`);
            }

            // Type size invariants: keep base type-sm (13px) for features, type-xl (~23.5px) for tagline, type-3xl (~31.6px) for h1.
            const featuresEl = brand.querySelector(".features");
            const featuresFont = parseFloat(getComputedStyle(featuresEl).fontSize);
            if (featuresFont < 12.9) {
              out.push(\\\`features font shrunk: \\\${featuresFont.toFixed(1)}px < 13px\\\`);
            }
            const taglineFont = parseFloat(getComputedStyle(tagline).fontSize);
            if (taglineFont < 22.5) {
              out.push(\\\`tagline font shrunk: \\\${taglineFont.toFixed(1)}px < 23.5px\\\`);
            }
            if (activeH1) {
              const h1Font = parseFloat(getComputedStyle(activeH1).fontSize);
              if (h1Font < 30.5) {
                out.push(\\\`h1 font shrunk: \\\${h1Font.toFixed(1)}px < 31.6px\\\`);
              }
            }

            const features = [...brand.querySelectorAll(".features li")];
            if (features.length < 7) out.push(\\\`brand features count: \\\${features.length}\\\`);
            for (const li of features) {
              const r = li.getBoundingClientRect();
              if (r.height === 0 || getComputedStyle(li).display === "none") out.push("hidden brand feature");
              if (r.bottom > brandRect.bottom + 1) out.push("brand feature clipped vertically");
              if (r.right > brandRect.right + 1) out.push("brand feature clipped horizontally");
              const textSpan = li.children[1];
              if (textSpan) {
                const range = document.createRange();
                range.selectNodeContents(textSpan);
                const tops = new Set();
                for (const cr of range.getClientRects()) {
                  if (cr.width > 0 && cr.height > 0) tops.add(Math.round(cr.top / 4));
                }
                if (tops.size > 1) {
                  out.push(\\\`brand feature wrapped to \\\${tops.size} lines: "\\\${textSpan.textContent}"\\\`);
                }
              }
            }

            checkJaWordSplits(tagline, "tagline");
            checkJaWordSplits(activeH1, \\\`h1(\\\${targetStep})\\\`);
            for (const li of features) checkJaWordSplits(li.children[1], "feature");

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

            if (targetStep === "language") {
              const choicesEl = document.querySelector("#language");
              const choices = [...choicesEl.querySelectorAll(".choice")];
              const gridRect = choicesEl.getBoundingClientRect();
              const rows = new Map();
              const distinctCols = new Set();
              for (const c of choices) {
                const cr = c.getBoundingClientRect();
                const rowKey = Math.round(cr.top / 6);
                if (!rows.has(rowKey)) rows.set(rowKey, []);
                rows.get(rowKey).push(cr);
                const fullSpan = cr.width >= gridRect.width - 8;
                if (!fullSpan) distinctCols.add(Math.round(cr.left / 8));
              }
              const colCount = Math.max(1, distinctCols.size);
              if (colCount > 1) {
                // Every row in a multi-column grid must be completely filled (no empty cells).
                for (const [, rects] of rows) {
                  const fullSpan = rects.length === 1 && rects[0].width >= gridRect.width - 8;
                  if (!fullSpan && rects.length !== colCount) {
                    out.push(\\\`language grid has empty cell: \\\${rects.length} items in \\\${colCount}-col row\\\`);
                  }
                }
              }
            }

            if (targetStep === "intro") {
              const video = document.querySelector("#intro-video");
              const liveCap = document.querySelector("#intro-live-caption");
              const expectedSrc = \\\`media/intro.\\\${document.documentElement.lang}.mp4\\\`;
              if (video?.getAttribute("src") !== expectedSrc) out.push(\\\`wrong video src: \\\${video?.getAttribute("src")}\\\`);
              const vr = video.getBoundingClientRect();
              if (sizeName === "1000x720" && vr.width < 560 - 1) {
                out.push(\\\`video too small at 1000x720: \\\${Math.round(vr.width)}x\\\${Math.round(vr.height)} (need width >= 560)\\\`);
              }
              if ((sizeName === "840x580" || sizeName === "824x541") && vr.width < 420 - 1) {
                out.push(\\\`video too small at \\\${sizeName}: \\\${Math.round(vr.width)}x\\\${Math.round(vr.height)} (need width >= 420)\\\`);
              }
              // Native Chromium video controls bar (~56-68px) must leave clear demo space above it.
              if (vr.height < 210) {
                out.push(\\\`video too short for native controls: height \\\${Math.round(vr.height)}px < 210px\\\`);
              }
              if (liveCap) {
                const tracks = Array.from(video?.textTracks ?? []);
                const active = tracks.find(t => t.mode === "showing");
                if (!active || active.language !== document.documentElement.lang) out.push(\\\`wrong caption track: \\\${active?.language}\\\`);
                // Caption box must be visible and show the first cue of the UI language before Play, with zero layout jump.
                const capStyle = getComputedStyle(liveCap);
                if (liveCap.hidden || capStyle.display === "none" || capStyle.visibility !== "visible") {
                  out.push(\\\`caption box not visible before Play (hidden=\\\${liveCap.hidden}, display=\\\${capStyle.display}, visibility=\\\${capStyle.visibility})\\\`);
                }
                const expectedFirstCue = \${JSON.stringify(FIRST_CUES[lang] || FIRST_CUES.en)};
                const actualBeforePlay = (liveCap.textContent || "").trim();
                if (actualBeforePlay !== expectedFirstCue) {
                  out.push(\\\`caption before Play mismatch: got "\\\${actualBeforePlay}", expected "\\\${expectedFirstCue}"\\\`);
                }
                checkJaWordSplits(liveCap, "intro-live-caption");
                const livePractice = document.querySelector("#live-practice");
                const beforeTop = livePractice ? livePractice.getBoundingClientRect().top : 0;
                const prevText = liveCap.innerHTML;
                const prevEmpty = liveCap.dataset.empty;
                const prevHidden = liveCap.hidden;
                const beforeRect = liveCap.getBoundingClientRect();
                if (beforeRect.top < vr.bottom - 1) out.push(\\\`caption overlaps video before Play: \\\${Math.round(beforeRect.top)} < \\\${Math.round(vr.bottom)}\\\`);
                liveCap.textContent = active?.cues?.[1]?.text || "Follow the highlight. The app underneath stays clickable.";
                liveCap.hidden = false;
                liveCap.dataset.empty = "false";
                void document.body.offsetHeight;
                const afterTop = livePractice ? livePractice.getBoundingClientRect().top : 0;
                const cr = liveCap.getBoundingClientRect();
                if (Math.abs(afterTop - beforeTop) > 1) {
                  out.push(\\\`layout jumped when caption changed: delta \\\${Math.round(afterTop - beforeTop)}px\\\`);
                }
                if (cr.top < vr.bottom - 1) out.push(\\\`caption overlaps video: \\\${Math.round(cr.top)} < \\\${Math.round(vr.bottom)}\\\`);
                if (panel.scrollHeight > panel.clientHeight + 1) {
                  out.push(\\\`panel vertical scrollbar with caption: \\\${panel.scrollHeight} > \\\${panel.clientHeight}\\\`);
                }
                liveCap.innerHTML = prevText;
                liveCap.hidden = prevHidden;
                if (prevEmpty !== undefined) liveCap.dataset.empty = prevEmpty;
              }
              // Check all 7 guide items (open disclosure if wrapped in <details>).
              const disclosure = document.querySelector('[data-step="intro"] details');
              const wasOpen = disclosure ? disclosure.open : false;
              if (disclosure) { disclosure.open = true; void document.body.offsetHeight; }
              const guides = [...document.querySelectorAll('[data-step="intro"] .guide-list li')];
              if (guides.length < 7) out.push(\\\`guide list count: \\\${guides.length}\\\`);
              for (const li of guides) {
                const r = li.getBoundingClientRect();
                if (r.height === 0) out.push("hidden guide item");
                checkJaWordSplits(li.children[1], "guide-item");
              }
              if (panel.scrollWidth > panel.clientWidth + 1) {
                out.push(\\\`panel horizontal overflow with guide open: \\\${panel.scrollWidth} > \\\${panel.clientWidth}\\\`);
              }
              if (disclosure) { disclosure.open = wasOpen; void document.body.offsetHeight; }
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

  // Verify bridge-supplied platform/configured shortcuts render in both buddy and dictation guide lines.
  win.setContentSize(1000, 720);
  await waitViewport(win.webContents, 1000, 720);
  win.webContents.send("mock:setState", { lang: "en", resolvedLang: "en", theme: "dark", resolvedTheme: "dark" });
  await flushLayout(win.webContents);
  const scCheck = await win.webContents.executeJavaScript(\`(() => {
    const out = [];
    document.querySelector("#start").click();
    const buddy = document.querySelector('[data-guide="welcome.guideBuddy"]')?.textContent
      || document.querySelector('[data-i18n="welcome.guideBuddy"]')?.textContent || "";
    const dict = document.querySelector('[data-guide="welcome.guideDictation"]')?.textContent || "";
    if (!buddy.includes("Control + Option")) out.push(\\\`buddy guide did not use bridge talk shortcut: "\\\${buddy}"\\\`);
    if (!dict.includes("Control + Command")) out.push(\\\`dictation guide did not use bridge dictation shortcut: "\\\${dict}"\\\`);
    document.querySelector("#back").click();
    return out;
  })()\`);
  shortcutProblems.push(...scCheck);

  // Check 200% zoom at 1000x720 (effective 500x360 viewport) in IT and JA: no horizontal overflow, primary CTA visible.
  win.setContentSize(1000, 720);
  win.webContents.setZoomFactor(2);
  await waitViewport(win.webContents, 500, 360);
  for (const zLang of ["it", "ja"]) {
    win.webContents.send("mock:setState", { lang: zLang, resolvedLang: zLang, theme: "dark", resolvedTheme: "dark" });
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
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(\\\`\\\${\${JSON.stringify(zLang)}} \\\${targetStep}: root horizontal overflow at 200%\\\`);
        if (panel.scrollWidth > panel.clientWidth + 1) out.push(\\\`\\\${\${JSON.stringify(zLang)}} \\\${targetStep}: panel horizontal overflow at 200%\\\`);
        if (startRect.bottom > window.innerHeight + 1) out.push(\\\`\\\${\${JSON.stringify(zLang)}} \\\${targetStep}: primary CTA clipped at 200%\\\`);
        return out;
      })()\`);
      zoomProblems.push(...zp);
    }
    await win.webContents.executeJavaScript('document.querySelector("#back").click()');
    await flushLayout(win.webContents);
  }
  win.webContents.setZoomFactor(1);
  await waitViewport(win.webContents, 1000, 720);

  // Check keyboard focus and accessible names (Narrator), plus JA headings on all 4 steps (mic & setup included).
  const a11y = await win.webContents.executeJavaScript(\`(() => {
    const out = [];
    const features = document.querySelector(".features");
    if (!features?.getAttribute("aria-label")?.trim()) out.push("features list missing aria-label");
    const guideList = document.querySelector('[data-step="intro"] .guide-list');
    if (!guideList?.getAttribute("aria-label")?.trim()) out.push("guide list missing aria-label");
    document.querySelector("#start").click();
    if (document.activeElement?.id !== "h-intro") out.push(\\\`expected focus on h-intro, got \\\${document.activeElement?.id}\\\`);
    document.querySelector("#back").click();
    if (document.activeElement?.id !== "h-language") out.push(\\\`expected focus on h-language, got \\\${document.activeElement?.id}\\\`);
    return out;
  })()\`);
  a11yProblems.push(...a11y);

  // Verify JA headings on mic and setup steps have no word splits at 840x580 and 1000x720.
  for (const size of [{ name: "1000x720", w: 1000, h: 720 }, { name: "840x580", w: 840, h: 580 }]) {
    win.setContentSize(size.w, size.h);
    await waitViewport(win.webContents, size.w, size.h);
    win.webContents.send("mock:setState", { lang: "ja", resolvedLang: "ja", theme: "dark", resolvedTheme: "dark" });
    await flushLayout(win.webContents);
    const jaStepProblems = await win.webContents.executeJavaScript(\`(() => {
      const out = [];
      const jaSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
      function checkJa(el, label) {
        if (!el) return;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const chars = [];
        let fullText = "";
        let node;
        while ((node = walker.nextNode())) {
          const text = node.nodeValue || "";
          for (let i = 0; i < text.length; i++) chars.push({ node, offset: i, ch: text[i] });
          fullText += text;
        }
        const lines = [];
        const range = document.createRange();
        for (let i = 0; i < chars.length; i++) {
          if (/\\s/.test(chars[i].ch)) continue;
          range.setStart(chars[i].node, chars[i].offset);
          range.setEnd(chars[i].node, chars[i].offset + 1);
          const r = range.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const last = lines[lines.length - 1];
          if (!last || Math.abs(r.top - last.top) > Math.max(4, r.height * 0.4)) lines.push({ top: r.top, startIdx: i });
        }
        if (lines.length <= 1) return;
        const segments = [...jaSegmenter.segment(fullText)];
        for (let l = 1; l < lines.length; l++) {
          const idx = lines[l].startIdx;
          const splitSeg = segments.find(s => s.isWordLike && s.index < idx && idx < s.index + s.segment.length);
          if (splitSeg) out.push(\\\`JA split in \\\${label}: \\\${splitSeg.segment}\\\`);
        }
      }
      // Step 1 -> 2 (intro) -> 3 (mic) -> 4 (setup), then back to 1.
      document.querySelector("#start").click();
      document.querySelector("#start").click();
      void document.body.offsetHeight;
      checkJa(document.querySelector("#h-mic"), "h-mic");
      document.querySelector("#start").click();
      void document.body.offsetHeight;
      checkJa(document.querySelector("#h-setup"), "h-setup");
      document.querySelector("#back").click();
      document.querySelector("#back").click();
      document.querySelector("#back").click();
      return out;
    })()\`);
    if (jaStepProblems.length > 0) issues.push({ lang: "ja", theme: "dark", size: size.name, step: "mic/setup", problems: jaStepProblems });
  }

  // Verify opening "How to start each feature" scrolls the guide list into view above the sticky action bar,
  // and respects prefers-reduced-motion.
  for (const size of [{ name: "1000x720", w: 1000, h: 720 }, { name: "840x580", w: 840, h: 580 }, { name: "824x541", w: 824, h: 541 }]) {
    win.setContentSize(size.w, size.h);
    await waitViewport(win.webContents, size.w, size.h);
    for (const gLang of ["it", "ja", "ru"]) {
      win.webContents.send("mock:setState", { lang: gLang, resolvedLang: gLang, theme: "dark", resolvedTheme: "dark" });
      await flushLayout(win.webContents);
      const gp = await win.webContents.executeJavaScript(\`(async () => {
        const out = [];
        const label = \${JSON.stringify(size.name + " " + gLang)};
        const current = document.querySelector(".step:not([hidden])")?.dataset.step;
        if (current !== "intro") document.querySelector("#start").click();
        const panel = document.querySelector(".panel");
        const disclosure = document.querySelector("#guide-disclosure");
        const summary = disclosure.querySelector("summary");
        const actions = document.querySelector(".actions");
        disclosure.open = false;
        panel.scrollTop = 0;
        await new Promise(r => setTimeout(r, 30));

        // Capture scrollTo behavior for both normal motion and reduced motion.
        const origScrollTo = panel.scrollTo.bind(panel);
        const origMatchMedia = window.matchMedia.bind(window);
        const calls = [];
        panel.scrollTo = (...args) => {
          calls.push(args[0]);
          return origScrollTo(...args);
        };
        try {
          // 1. Reduced motion: must not use smooth scroll and must reveal the guide immediately.
          window.matchMedia = (q) => q.includes("prefers-reduced-motion")
            ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
            : origMatchMedia(q);
          summary.click();
          await new Promise(r => setTimeout(r, 60));
          const panelRectR = panel.getBoundingClientRect();
          const actionsRectR = actions.getBoundingClientRect();
          const itemsR = [...disclosure.querySelectorAll(".guide-list li")];
          const firstR = itemsR[0].getBoundingClientRect();
          const lastR = itemsR[itemsR.length - 1].getBoundingClientRect();
          if (firstR.top < panelRectR.top - 1 || firstR.bottom > actionsRectR.top + 1) {
            out.push(\\\`\\\${label} (reduced-motion): first guide item not visible above actions (item \\\${Math.round(firstR.top)}..\\\${Math.round(firstR.bottom)}, actions.top=\\\${Math.round(actionsRectR.top)})\\\`);
          }
          if (lastR.bottom > actionsRectR.top + 1) {
            out.push(\\\`\\\${label} (reduced-motion): opened guide still hidden under actions (last.bottom=\\\${Math.round(lastR.bottom)} > actions.top=\\\${Math.round(actionsRectR.top)})\\\`);
          }
          const reducedBehaviors = calls.map(c => (c && typeof c === "object" ? c.behavior : undefined));
          if (reducedBehaviors.includes("smooth")) {
            out.push(\\\`\\\${label} (reduced-motion): used smooth scroll when reduced motion is requested\\\`);
          }

          // 2. Normal motion: close, reset, reopen and wait for scroll to settle.
          calls.length = 0;
          summary.click();
          panel.scrollTop = 0;
          await new Promise(r => setTimeout(r, 30));
          window.matchMedia = (q) => q.includes("prefers-reduced-motion")
            ? { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
            : origMatchMedia(q);
          summary.click();
          // Wait for async <details> toggle to call scrollTo({ top, behavior: "smooth" }).
          const callDeadline = Date.now() + 1000;
          let smoothCall = null;
          while (Date.now() < callDeadline && !smoothCall) {
            await new Promise(r => setTimeout(r, 20));
            smoothCall = calls.find(c => c && typeof c === "object" && typeof c.top === "number") || null;
          }
          if (!smoothCall || smoothCall.behavior !== "smooth") {
            out.push(\\\`\\\${label} (normal): expected smooth scroll call, got \\\${JSON.stringify(calls)}\\\`);
          } else {
            // Hidden BrowserWindows can throttle smooth-scroll compositor frames; settle at the exact requested target.
            const settleDeadline = Date.now() + 300;
            const maxTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
            const goal = Math.min(smoothCall.top, maxTop);
            while (Date.now() < settleDeadline && Math.abs(panel.scrollTop - goal) > 1) {
              await new Promise(r => setTimeout(r, 20));
            }
            if (Math.abs(panel.scrollTop - goal) > 1) {
              origScrollTo({ top: smoothCall.top, behavior: "instant" });
              void document.body.offsetHeight;
            }
          }
          const panelRectN = panel.getBoundingClientRect();
          const actionsRectN = actions.getBoundingClientRect();
          const itemsN = [...disclosure.querySelectorAll(".guide-list li")];
          const firstN = itemsN[0].getBoundingClientRect();
          const lastN = itemsN[itemsN.length - 1].getBoundingClientRect();
          if (firstN.top < panelRectN.top - 1 || firstN.bottom > actionsRectN.top + 1) {
            out.push(\\\`\\\${label} (normal): first guide item not visible above actions (item \\\${Math.round(firstN.top)}..\\\${Math.round(firstN.bottom)}, actions.top=\\\${Math.round(actionsRectN.top)})\\\`);
          }
          if (lastN.bottom > actionsRectN.top + 1) {
            out.push(\\\`\\\${label} (normal): opened guide still hidden under actions (last.bottom=\\\${Math.round(lastN.bottom)} > actions.top=\\\${Math.round(actionsRectN.top)})\\\`);
          }
        } finally {
          panel.scrollTo = origScrollTo;
          window.matchMedia = origMatchMedia;
          disclosure.open = false;
          panel.scrollTop = 0;
          document.querySelector("#back").click();
        }
        return out;
      })()\`);
      guideRevealProblems.push(...gp);
      await flushLayout(win.webContents);
    }
  }

  process.stdout.write("LAYOUT_JSON:" + JSON.stringify({ issues, zoomProblems, a11yProblems, shortcutProblems, guideRevealProblems }) + "\\n");
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
      timeout: 35_000,
    });
    const line = raw.split(/\r?\n/).find(l => l.startsWith("LAYOUT_JSON:"));
    if (!line) throw new Error(`No layout output from Electron:\n${raw}`);
    return JSON.parse(line.slice("LAYOUT_JSON:".length));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("welcome window layout across all languages, themes and sizes", () => {
  // Explicit 45 s timeout (R31): spawns one Electron instance to measure 5 languages x 2 themes x 4 sizes + guide reveal + 200% zoom + JA word-break geometry.
  it("fits cleanly with big video, 13px single-line features, phrase-aware JA breaks, no empty grid cells, pre-Play caption, guide scroll reveal and platform shortcuts", () => {
    const { issues, zoomProblems, a11yProblems, shortcutProblems, guideRevealProblems } = measureWelcomeLayout();
    expect.soft(issues).toEqual([]);
    expect.soft(shortcutProblems).toEqual([]);
    expect.soft(guideRevealProblems).toEqual([]);
    expect.soft(zoomProblems).toEqual([]);
    expect.soft(a11yProblems).toEqual([]);
  }, 45_000);
});
