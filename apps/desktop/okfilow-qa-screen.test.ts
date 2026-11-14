import fs from "node:fs";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// FILOW_OKF_QA_SCREEN (okfilow.js): a measured run's synthetic screen. The real screen is never read,
// no overlay is ever built or shown, and the pointer and the pen send nothing. Checked here on OK
// Filow itself, with Electron replaced by a fake that counts what it is asked to do.
const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "okf-qa-screen-"));
const screenDir = path.join(tmp, "screens");
fs.mkdirSync(screenDir);
for (const n of ["001", "002"]) {
  fs.writeFileSync(path.join(screenDir, `${n}.png`), "png");
  fs.writeFileSync(path.join(screenDir, `${n}.json`), JSON.stringify({ elements: [{ name: `Pay now ${n}`, screen: 1, x1: 10, y1: 20, x2: 30, y2: 40 }] }));
}
fs.writeFileSync(path.join(screenDir, "notes.txt"), "not a picture");

const counts = { windows: 0, shown: 0, displays: 0, cursor: 0, sources: 0 };
/** The contents of every window made, so the test can find the panel's. */
const contentsMade: FakeContents[] = [];
const fakeImage = (w: number, h: number): Record<string, unknown> => ({
  getSize: () => ({ width: w, height: h }),
  resize: ({ width }: { width: number }) => fakeImage(width, Math.round((h * width) / w)),
  toJPEG: (q: number) => Buffer.from(`jpeg${w}x${h}q${q}`),
  isEmpty: () => false,
});
class FakeContents {
  mainFrame = { url: "" };
  sent: string[] = [];
  id = Math.floor(Math.random() * 1e9);
  getURL() { return this.mainFrame.url; }
  isDestroyed() { return false; }
  isLoading() { return false; }
  on() {}
  once() {}
  focus() {}
  setWindowOpenHandler() {}
  send(channel: string) { this.sent.push(channel); }
}
class FakeWindow {
  webContents = new FakeContents();
  visible = false;
  constructor() { counts.windows++; contentsMade.push(this.webContents); }
  loadURL(u: string) { this.webContents.mainFrame.url = u; }
  show() { counts.shown++; this.visible = true; }
  showInactive() { counts.shown++; this.visible = true; }
  isVisible() { return this.visible; }
  isDestroyed() { return false; }
  getSize() { return [380, 520]; }
  getBounds() { return { x: 0, y: 0, width: 1920, height: 1080 }; }
  setContentProtection() {}
  setPosition() {}
  setBounds() {}
  setIgnoreMouseEvents() {}
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  on() {}
  once() {}
  hide() {}
  focus() {}
  moveTop() {}
  destroy() {}
  static fromWebContents() { return null; }
}
const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
const ipcOn = new Map<string, (...a: unknown[]) => unknown>();
const ipcHandle = new Map<string, (...a: unknown[]) => unknown>();
const fakeElectron = {
  app: { isPackaged: false, getPath: () => tmp },
  BrowserWindow: FakeWindow,
  Tray: class { constructor() { counts.windows++; } setToolTip() {} on() {} setContextMenu() {} getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; } destroy() {} },
  Menu: { buildFromTemplate: () => ({}) },
  screen: {
    getAllDisplays: () => { counts.displays++; return [display]; },
    getCursorScreenPoint: () => { counts.cursor++; return { x: 5, y: 5 }; },
    getDisplayNearestPoint: () => display,
    on() {},
  },
  desktopCapturer: { getSources: vi.fn(async () => { counts.sources++; return []; }) },
  ipcMain: { on: (c: string, f: (...a: unknown[]) => unknown) => ipcOn.set(c, f), handle: (c: string, f: (...a: unknown[]) => unknown) => ipcHandle.set(c, f) },
  globalShortcut: { register: () => false, registerAll() {}, isRegistered: () => false, unregister() {}, unregisterAll() {} },
  nativeImage: { createFromPath: () => fakeImage(1920, 1080) },
  shell: { openExternal: async () => {}, openPath: async () => "" },
  systemPreferences: {},
  powerMonitor: { on() {} },
};

type Api = { togglePanel: () => void };
type Shot = { images: string[]; screens: unknown[]; displays: unknown[]; marked: unknown[]; selected: string; elements: unknown[] };
let api: Api;
let event: { sender: FakeContents; senderFrame: { url: string } };
let created: { createQaScreen: (dir: string, deps: Record<string, unknown>) => { count: number; capture: (images: boolean, maxWidth?: number) => Shot } };
const lines: string[] = [];
const settings = { okFilow: { enabled: true, seeScreen: "auto", provider: "local" } };
const loader = Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown };
const original = loader._load;

beforeAll(() => {
  loader._load = function (request: string, ...rest: unknown[]) {
    if (request === "electron") return fakeElectron;
    return original.call(this, request, ...rest);
  };
  process.env.FILOW_OKF_QA_SCREEN = screenDir;
  const okf = require("./okfilow.js") as { createOkFilow: (deps: Record<string, unknown>) => Api } & typeof created;
  created = okf;
  api = okf.createOkFilow({
    appUrl: "http://127.0.0.1:4811", getSettings: () => settings, saveSettings: () => {}, iconPath: "", logLine: (l: string) => lines.push(l),
    sttLocal: { modelReady: () => false }, userData: tmp, menuText: (k: string) => k, isOffline: () => true, elementReader: null,
    dictation: { status: () => ({ enabled: false, chord: "" }), cfg: () => ({ enabled: false }), onChange() {}, activeChord: () => null, diag: { mark() {} } },
  });
  api.togglePanel();
});
afterAll(() => {
  loader._load = original;
  delete process.env.FILOW_OKF_QA_SCREEN;
  // only the folder this file made
  if (path.basename(tmp).startsWith("okf-qa-screen-") && path.dirname(tmp) === path.resolve(os.tmpdir())) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("FILOW_OKF_QA_SCREEN: OK Filow's synthetic screen", () => {
  it("captures the next picture each time, through the real resize and JPEG quality, with its names, and never reads the screen", async () => {
    const windowsBefore = counts.windows;
    const capture = ipcHandle.get("okfilow:capture")!;
    // the panel's own page is the trusted sender (okfilowSender)
    const panelContents = findPanel();
    event = { sender: panelContents, senderFrame: panelContents.mainFrame };
    const before = { displays: counts.displays, cursor: counts.cursor };
    const a = (await capture(event, { images: true })) as Shot;
    const b = (await capture(event, { images: true })) as Shot;
    const c = (await capture(event, { images: true })) as Shot;
    const display1 = { index: 1, id: "qa-screen", bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
    expect(a).toEqual({
      images: [`data:image/jpeg;base64,${Buffer.from("jpeg512x288q72").toString("base64")}`],
      screens: [{ index: 1, width: 512, height: 288, cursor: true }],
      displays: [display1], marked: [], selected: "",
      elements: [{ name: "Pay now 001", screen: 1, x1: 10, y1: 20, x2: 30, y2: 40 }],
    });
    expect((b.elements[0] as { name: string }).name).toBe("Pay now 002");
    expect((c.elements[0] as { name: string }).name).toBe("Pay now 001");
    expect(fakeElectron.desktopCapturer.getSources).not.toHaveBeenCalled();
    expect(counts.sources).toBe(0);
    expect({ displays: counts.displays, cursor: counts.cursor }).toEqual(before);
    expect(counts.windows).toBe(windowsBefore);
  });

  it("with the eye closed, takes no picture and no names, on the same screen and display", async () => {
    const d = (await ipcHandle.get("okfilow:capture")!(event, { images: false })) as Shot;
    expect(d).toEqual({ images: [], screens: [{ index: 1, width: 512, height: 288, cursor: true }], displays: [{ index: 1, id: "qa-screen", bounds: { x: 0, y: 0, width: 1920, height: 1080 } }], marked: [], selected: "", elements: [] });
  });

  it("builds and shows no overlay, and the pointer and the pen send nothing", async () => {
    const windowsBefore = counts.windows;
    const shownBefore = counts.shown;
    // a question being answered would show the overlays; a talk press would catch the mouse
    await ipcHandle.get("okfilow:setMode")!(event, "thinking", {});
    ipcOn.get("okfilow:point")!(event, [{ x: 10, y: 10, label: "Pay now" }]);
    ipcOn.get("okfilow:draw")!(event, [{ kind: "circle", x: 10, y: 10, r: 20, label: "Pay now" }]);
    ipcOn.get("okfilow:cards")!(event, []);
    await ipcHandle.get("okfilow:setMode")!(event, "idle", {});
    expect(counts.windows).toBe(windowsBefore);
    expect(counts.shown).toBe(shownBefore);
    expect(lines.filter((l) => /qa (points|overlays shown)/.test(l))).toEqual([]);
  });

  it.each(["cloud", "freellm"])("preserves the online %s image and screen dimensions", async (provider) => {
    settings.okFilow.provider = provider;
    try {
      const shot = await ipcHandle.get("okfilow:capture")!(event, { images: true }) as Shot;
      expect(shot.images).toEqual(["data:image/jpeg;base64," + Buffer.from("jpeg1024x576q72").toString("base64")]);
      expect(shot.screens).toEqual([{ index: 1, width: 1024, height: 576, cursor: true }]);
      expect(shot.displays).toEqual([{ index: 1, id: "qa-screen", bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]);
    } finally { settings.okFilow.provider = "local"; }
  });

  it("does not enlarge small captures or rescale normalized target rectangles", () => {
    const reader = created.createQaScreen(screenDir, { nativeImage: { createFromPath: () => fakeImage(320, 180) } });
    const shot = reader.capture(true, 512);
    expect(shot.screens).toEqual([{ index: 1, width: 320, height: 180, cursor: true }]);
    expect(shot.elements[0]).toMatchObject({ x1: 10, y1: 20, x2: 30, y2: 40 });
    const src = fs.readFileSync(new URL("./okfilow.js", import.meta.url), "utf8");
    expect(src).toContain('if (size.width > maxWidth) img = img.resize({ width: maxWidth, quality: "good" });');
    expect(src).toContain('qaScreen.capture(wantImages, maxWidth)');
  });

  it("is ignored outside a QA build", () => {
    const src = fs.readFileSync(new URL("./okfilow.js", import.meta.url), "utf8");
    expect(src).toMatch(/const QA_SCREEN = QA_ALLOWED \? process\.env\.FILOW_OKF_QA_SCREEN \|\| "" : "";/);
  });

  it("refuses a folder without pictures, and counts only NNN.png", () => {
    expect(created.createQaScreen(screenDir, { nativeImage: fakeElectron.nativeImage }).count).toBe(2);
    expect(() => created.createQaScreen(tmp, { nativeImage: fakeElectron.nativeImage })).toThrow(/no NNN\.png/);
  });
});

/** The panel window togglePanel built: the only window on an /okfilow/panel page. */
function findPanel(): FakeContents {
  const found = contentsMade.find((c) => c.mainFrame.url.endsWith("/okfilow/panel"));
  if (!found) throw new Error("panel not built");
  return found;
}
