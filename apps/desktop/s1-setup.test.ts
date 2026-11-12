// S1-mini by Superwhisper in the setup: the welcome's setup step and the setup picker in Settings offer it
// ticked, with one size, and all end in one download path. The Windows installer does not offer it (or
// any other download) any more: the app's own setup decides for the PC.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { CLEANUP_MODEL as CORE_MODEL, DICTIONARIES, LANGS } from "@filow/core";
import { offerGb, offersDownload } from "./welcome-flow";

const require = createRequire(import.meta.url);
const { wantModel, MODEL, SETUP_ID } = require("./s1-runtime.js") as {
  wantModel(rt: unknown, store: { set(v: boolean): void }, canFetch?: () => boolean): { started: boolean; reason?: string };
  MODEL: { bytes: number }; SETUP_ID: string;
};
const { withCleanup, setupOffer, setupChoice, savedSetupAnswer, probeSetup, CLEANUP_MODEL } = require("./welcome-setup.js");
const here = (f: string) => fs.readFileSync(path.join(__dirname, f), "utf8");
const MB = `${Math.round(MODEL.bytes / 1024 / 1024)} MB`;

const CATALOG = { "nemotron-streaming": { dl: 0.45, ollama: false }, "clef-flash": { dl: 11, ollama: true }, "s1-mini": { dl: 0.46, ollama: false } };
const rec = { models: ["nemotron-streaming", "clef-flash"], ollama: true, downloadGb: 11.5 };
const none = { sherpa: false, ollamaRunning: false, ollamaModels: [] as string[], browserCache: false, cleanup: false };
const hw = { ramGb: 8, platform: "win32" };

function fakeRuntime(state: { runtime: boolean; model: boolean }, outcome = true) {
  const fetchModel = vi.fn(async () => { if (outcome) state.model = true; return outcome; });
  return { status: () => ({ ...state }), fetchModel };
}
function store() {
  const s = { wanted: false as boolean, sets: [] as boolean[], set(v: boolean) { s.wanted = v; s.sets.push(v); } };
  return s;
}

describe("S1-mini in the setup: one download path, kept until the file is here", () => {
  it("starts the download and forgets the wish once the file is on this computer", async () => {
    const rt = fakeRuntime({ runtime: true, model: false });
    const s = store();
    expect(wantModel(rt, s)).toEqual({ started: true });
    expect(s.wanted).toBe(true); // kept while it downloads: a quit now is finished at the next start
    await rt.fetchModel.mock.results[0].value;
    await Promise.resolve();
    expect(rt.fetchModel).toHaveBeenCalledOnce();
    expect(s.wanted).toBe(false);
  });
  it("offline during setup: nothing is fetched and the wish stays for a later start", () => {
    const rt = fakeRuntime({ runtime: true, model: false });
    const s = store();
    expect(wantModel(rt, s, () => false)).toEqual({ started: false, reason: "offline" });
    expect(rt.fetchModel).not.toHaveBeenCalled();
    expect(s.wanted).toBe(true);
  });
  it("a download that fails (no network after all) keeps the wish", async () => {
    const rt = fakeRuntime({ runtime: true, model: false }, false);
    const s = store();
    wantModel(rt, s);
    await rt.fetchModel.mock.results[0].value;
    await Promise.resolve();
    expect(s.wanted).toBe(true);
  });
  it("already here: no download, and an old wish is cleared", () => {
    const rt = fakeRuntime({ runtime: true, model: true });
    const s = store();
    s.wanted = true;
    expect(wantModel(rt, s)).toEqual({ started: false, reason: "present" });
    expect(rt.fetchModel).not.toHaveBeenCalled();
    expect(s.wanted).toBe(false);
  });
  it("a build without the runtime never keeps a wish it could not use", () => {
    const rt = fakeRuntime({ runtime: false, model: false });
    const s = store();
    expect(wantModel(rt, s)).toEqual({ started: false, reason: "no runtime" });
    expect(s.sets).toEqual([]);
  });
  it("the welcome's answer, the first-start dialog and the Settings button all go through wantCleanupModel in main.js", () => {
    const main = here("main.js");
    expect(main).not.toMatch(/\.fetchModel\(/); // only s1-runtime.js wantModel starts the download
    expect(main.match(/wantCleanupModel\(/g)!.length).toBeGreaterThanOrEqual(3); // its definition, Settings, the setup
    expect(main).toMatch(/ipcMain\.handle\("dictation:cleanup:download"[\s\S]{0,160}wantCleanupModel\("asked in Settings"\)/);
    expect(main).toMatch(/choices\.models\.includes\(CLEANUP_MODEL\)/);
    expect(main).toMatch(/settings\.cleanupModelWanted\) wantCleanupModel\(/);
    // the settings page asks the app for the same thing, it does not download by itself
    const page = fs.readFileSync(path.join(__dirname, "../web/app/settings/local/page.tsx"), "utf8");
    expect(page).toMatch(/m\.runtime === "llama"[\s\S]{0,260}downloadCleanup/);
  });
});

describe("S1-mini in the welcome's setup step", () => {
  it("joins every recommendation, whatever the tier, when the runtime is in the build and the file is not here", () => {
    const withIt = withCleanup(rec, { runtime: true, model: false }, CATALOG);
    expect(withIt.models).toEqual([...rec.models, "s1-mini"]);
    expect(withIt.downloadGb).toBe(12);
    expect(withCleanup({ models: [], ollama: false, downloadGb: 0 }, { runtime: true, model: false }, CATALOG).models).toEqual(["s1-mini"]); // a PC with nothing else recommended
    expect(withCleanup(rec, { runtime: true, model: true }, CATALOG)).toBe(rec);
    expect(withCleanup(rec, { runtime: false, model: false }, CATALOG)).toBe(rec);
    expect(withCleanup(rec, null, CATALOG)).toBe(rec);
    expect(withCleanup(withIt, { runtime: true, model: false }, CATALOG)).toBe(withIt); // never twice
    expect(CLEANUP_MODEL).toBe(SETUP_ID);
  });
  it("the offer carries it as its own line with the real size, counted in the total", () => {
    const r = withCleanup(rec, { runtime: true, model: false }, CATALOG);
    const o = setupOffer({ hw, rec: r, catalog: CATALOG, installed: none, online: true });
    expect(o.cleanup).toEqual({ id: "s1-mini", bytes: 484219808, gb: 0.46 });
    expect(o.downloadGb).toBe(11.9);
    expect(o.ready).toBe(false); // it is not needed for a take, the speech and decision models are
    expect(setupOffer({ hw, rec: r, catalog: CATALOG, installed: { ...none, cleanup: true }, online: true }).cleanup).toBeNull();
    expect(setupOffer({ hw, rec, catalog: CATALOG, installed: none, online: true }).cleanup).toBeNull();
  });
  it("ticked: it is in the answer; unticked: it is not, and its share leaves the size shown", () => {
    const r = withCleanup(rec, { runtime: true, model: false }, CATALOG);
    const o = setupOffer({ hw, rec: r, catalog: CATALOG, installed: none, online: true });
    expect(setupChoice(o, r, true, CATALOG, none).models).toContain("s1-mini");
    expect(setupChoice(o, r, true, CATALOG, none, false).models).toEqual(rec.models);
    expect(offerGb(o, true)).toBe(11.9);
    expect(offerGb(o, false)).toBe(11.4);
    // the only thing missing, and unticked: nothing to download, so the step's button finishes
    const only = { models: ["s1-mini"], ollama: false, downloadGb: 0.5 };
    const o2 = setupOffer({ hw, rec: only, catalog: CATALOG, installed: none, online: true });
    expect(offersDownload(o2)).toBe(true);
    expect(offersDownload({ ...o2, downloadGb: offerGb(o2, false) })).toBe(false);
    expect(setupChoice(o2, only, true, CATALOG, none, false)).toBeNull();
    expect(offerGb({ downloadGb: 3 }, false)).toBe(3);
  });
  it("an answer saved before a quit keeps it, and the probe reports whether the file is here", async () => {
    expect(savedSetupAnswer({ choice: { models: ["s1-mini"], ollama: false } }, CATALOG)).toEqual({ choice: { models: ["s1-mini"], ollama: false } });
    expect((await probeSetup({ fetchJson: async () => null, sherpaReady: () => false, cleanupReady: () => true })).cleanup).toBe(true);
    expect((await probeSetup({ fetchJson: async () => null, sherpaReady: () => false })).cleanup).toBe(false);
    expect((await probeSetup({ fetchJson: async () => null, sherpaReady: () => false, cleanupReady: () => { throw new Error("EPERM"); } })).cleanup).toBe(false);
  });
  it("the page has the line as a ticked checkbox and sends the tick with the answer", () => {
    expect(here("welcome.html")).toMatch(/<input type="checkbox" id="setup-cleanup" checked>/);
    expect(here("welcome.ts")).toContain("bridge.chooseSetup(acceptSetup, cleanupTicked)");
    expect(here("welcome-preload.js")).toContain('ipcRenderer.invoke("welcome:chooseSetup", accept === true, cleanup !== false)');
  });
});

describe("S1-mini: one name and one size everywhere", () => {
  const nsh = here("build/installer.nsh");
  it("the size is the pinned file's, in every place that states it", () => {
    expect(CORE_MODEL.bytes).toBe(MODEL.bytes);
    expect(CORE_MODEL.name).toBe(SETUP_ID);
    expect(MB).toBe("462 MB");
    expect(here("localai.js")).toMatch(/"s1-mini": \{ dl: 0\.46, /);
    expect(CORE_MODEL.downloadGb).toBe(0.46);
  });
  // Easy settings: the installer's page of model names is gone, and with it the file that made the app
  // skip its own first-run setup. What to download is decided by the app, with the rule the app uses.
  it("the installer names no download and writes no choices: the app's own setup decides", () => {
    for (const word of ["S1-mini", "Superwhisper", "Whisper", "Clef", "Gemma", "Ollama", "GPU", "RAM"]) expect(nsh.includes(word), word).toBe(false);
    for (const part of ["MUI_PAGE_COMPONENTS", "customPageAfterChangeDir", "InstType", "SectionGroup", "Section /o", "AddSize", "install-choices", "FileWrite", "FileOpen", "$APPDATA"]) expect(nsh.includes(part), part).toBe(false);
    // what it still does: welcome, information and finish pages, in every installer language
    for (const page of ["!macro customWelcomePage", "!insertmacro MUI_PAGE_WELCOME", '!insertmacro MUI_PAGE_LICENSE "$(FilowInfo)"', "!macro customFinishPage", "!insertmacro MUI_PAGE_FINISH", "Function CreateDesktopLink", "Function StartAppNow", "!macro customInstall"]) expect(nsh.includes(page), page).toBe(true);
    for (const name of ["WelcomeTitle", "WelcomeText", "RunText", "ShortcutText", "InfoTitle", "InfoSub", "InfoTop"]) {
      expect(nsh.split(/\r?\n/).filter((l) => l.trim().startsWith(`StrCpy $${name} "`)), name).toHaveLength(12);
      expect(nsh).toContain(`Var ${name}\r\n`);
    }
    // every variable that is declared is set and used (makensis fails the build on an unused one)
    const vars = [...nsh.matchAll(/^Var (\w+)\r?$/gm)].map((m) => m[1]);
    expect(vars).toHaveLength(7);
    for (const v of vars) expect(nsh.split(`$${v}`).length - 1, v).toBeGreaterThanOrEqual(13);
    // the Romanian strings NSIS lacks are still supplied
    expect(nsh.match(/^!define FILOW_Romanian_MULTIUSER_/gm)).toHaveLength(5);
    expect(nsh).not.toMatch(/\r?\n[^\r\n]*[^\r]\n/); // CRLF throughout
  });
  it("a file left by an older installer is not followed: main.js never reads it and always asks through its own setup", () => {
    const main = here("main.js");
    expect(main.includes("installChoicesFound")).toBe(false);
    expect(main.includes("readInstallChoices")).toBe(false);
    expect(main.includes("return { firstRun, askSetup: firstRun && !settings.localAiOffered };")).toBe(true);
    expect(/function dropInstallerChoices\(\) \{\s*try \{\s*fs\.rmSync\(path\.join\(userData, "install-choices\.json"\), \{ force: true \}\);/.test(main)).toBe(true);
    expect(/loadSettings\(\);[\s\S]{0,300}dropInstallerChoices\(\);/.test(main)).toBe(true);
    expect(main.includes("if (!choices && !settings.localAiOffered) choices = await offerLocalAi();")).toBe(true);
  });
  it("five languages name it exactly and state the size where it is offered", () => {
    for (const lang of LANGS) {
      const d = DICTIONARIES[lang] as Record<string, string>;
      for (const key of ["welcome.setupCleanup", "setup.cleanup", "setup.cleanupGetting", "catalog.s1-mini"]) expect(d[key], `${lang} ${key}`).toContain("S1-mini by Superwhisper");
      expect(d["welcome.setupCleanup"]).toContain("{size}");
      expect(d["setup.cleanup"]).toContain("{size}");
      expect(d["setup.cleanupGetting"]).toContain("{pct}");
    }
  });
});
