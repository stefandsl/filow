import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createPagePermissions } = require("./page-permissions.js");

const APP_URL = "http://127.0.0.1:4747";
// The same test as isAppPage in main.js.
const isAppPage = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && u.origin === APP_URL;
  } catch {
    return false;
  }
};
const appDir = path.resolve("/Filow/resources/app.asar");
const welcome = pathToFileURL(path.join(appDir, "welcome.html")).href;
const policy = createPagePermissions({ isAppPage, filePages: [welcome] });
const app = `${APP_URL}/okfilow/panel`;

/** What the request handler answers, as Electron calls it. */
const request = (permission: string, details: Record<string, unknown>) => {
  let answer: boolean | undefined;
  policy.request(null, permission, (granted: boolean) => { answer = granted; }, details);
  return answer;
};

describe("page permissions (SEC-08)", () => {
  it("grants the microphone to the app's pages and to the welcome window", () => {
    expect(request("media", { requestingUrl: app, mediaTypes: ["audio"] })).toBe(true);
    expect(request("media", { requestingUrl: welcome, mediaTypes: ["audio"] })).toBe(true);
    expect(policy.check(null, "media", APP_URL, { requestingUrl: app, mediaType: "audio" })).toBe(true);
    expect(policy.check(null, "media", "file://", { requestingUrl: welcome, mediaType: "audio" })).toBe(true);
  });

  it("refuses the camera, alone or asked together with the microphone", () => {
    expect(request("media", { requestingUrl: app, mediaTypes: ["video"] })).toBe(false);
    expect(request("media", { requestingUrl: app, mediaTypes: ["audio", "video"] })).toBe(false);
    expect(policy.check(null, "media", APP_URL, { requestingUrl: app, mediaType: "video" })).toBe(false);
  });

  it("refuses a media permission that names no type or an unknown one", () => {
    expect(request("media", { requestingUrl: app })).toBe(false);
    expect(request("media", { requestingUrl: app, mediaTypes: [] })).toBe(false);
    expect(policy.check(null, "media", APP_URL, { requestingUrl: app, mediaType: "unknown" })).toBe(false);
  });

  it("keeps screen capture and notifications for the app's pages", () => {
    expect(request("display-capture", { requestingUrl: app })).toBe(true);
    expect(request("display-capture", { requestingUrl: app, mediaTypes: ["video", "audio"] })).toBe(true);
    expect(request("notifications", { requestingUrl: app })).toBe(true);
    expect(policy.check(null, "notifications", APP_URL, { requestingUrl: app })).toBe(true);
  });

  it("refuses everything else, also on the app's own pages", () => {
    const others = ["geolocation", "midi", "midiSysex", "clipboard-read", "clipboard-sanitized-write", "fullscreen",
      "screen-wake-lock", "speaker-selection", "pointerLock", "openExternal", "hid", "serial", "usb"];
    for (const p of others) {
      expect(request(p, { requestingUrl: app }), p).toBe(false);
      expect(policy.check(null, p, APP_URL, { requestingUrl: app }), p).toBe(false);
    }
  });

  it("refuses every other page: other origins, look-alikes, and the shell's other file pages", () => {
    const pages = [
      "https://evil.test/",
      "http://127.0.0.1:4748/",
      "http://localhost:4747/",
      "http://127.0.0.1:4747.evil.test/",
      "https://abc.trycloudflare.com/", // the public link serves the same app, but not inside Filow's windows
      pathToFileURL(path.join(appDir, "splash.html")).href, // packaged, but never needs a permission
      pathToFileURL(path.join(appDir, "picker.html")).href,
      pathToFileURL(path.resolve("/Users/me/Downloads/welcome.html")).href,
      "file://",
      "data:text/html,<p>",
      "not a url",
      "",
    ];
    for (const url of pages) {
      expect(request("media", { requestingUrl: url, mediaTypes: ["audio"] }), url).toBe(false);
      expect(request("notifications", { requestingUrl: url }), url).toBe(false);
      expect(policy.check(null, "media", url, { mediaType: "audio" }), url).toBe(false);
    }
  });

  it("is only ever narrowed by the shell's own rule, never widened", () => {
    // main.js passes permissionFor: a test instance withholds the real microphone
    const noMic = createPagePermissions({ isAppPage, filePages: [welcome], permitted: (p: string) => p !== "media" });
    expect(noMic.allowed("media", app, ["audio"])).toBe(false);
    expect(noMic.allowed("display-capture", app, [])).toBe(true);
    expect(noMic.check(null, "media", APP_URL, { requestingUrl: app, mediaType: "audio" })).toBe(false);
    // a rule that says yes to everything still cannot grant the camera, another permission or another page
    const yes = createPagePermissions({ isAppPage, filePages: [welcome], permitted: () => true });
    expect(yes.allowed("media", app, ["video"])).toBe(false);
    expect(yes.allowed("geolocation", app, [])).toBe(false);
    expect(yes.allowed("media", "https://evil.test/", ["audio"])).toBe(false);
  });

  it("falls back to the check handler's origin when details carry no URL, and fails closed for files", () => {
    expect(policy.check(null, "notifications", APP_URL, {})).toBe(true);
    expect(policy.check(null, "notifications", "https://evil.test", {})).toBe(false);
    expect(policy.check(null, "media", "file://", { mediaType: "audio" })).toBe(false);
  });
});

describe("main.js wiring of the page permissions", () => {
  const main = readFileSync(path.resolve(__dirname, "main.js"), "utf8");

  it("sets both handlers from page-permissions, once, with the shell's own rule", () => {
    expect(main.split("setPermissionRequestHandler(")).toHaveLength(2);
    expect(main.split("setPermissionCheckHandler(")).toHaveLength(2);
    expect(main).toContain("setPermissionRequestHandler(pagePermissions.request)");
    expect(main).toContain("setPermissionCheckHandler(pagePermissions.check)");
    expect(main).toContain("createPagePermissions({ isAppPage, filePages: [welcomeUrl], permitted: permissionFor })");
  });

  it("sets them before any window can exist: the welcome window asks for the microphone first", () => {
    const body = main.slice(main.indexOf("async function main()"));
    const handlers = body.indexOf("setPermissionCheckHandler(pagePermissions.check)");
    expect(handlers).toBeGreaterThan(0);
    for (const first of ["seed(scriptFile", "settings.welcomeCompleted", "new BrowserWindow(", "startServers()"]) {
      expect(body.indexOf(first), first).toBeGreaterThan(handlers);
    }
  });
});
