import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const asset = (name: string) => readFileSync(new URL(name, import.meta.url));

describe("packaged Windows feedback", () => {
  it("passes the multi-size Windows icon to the tray", () => {
    const ico = asset("./build/icon.ico");
    const widths = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
    expect(widths).toEqual(expect.arrayContaining([16, 32]));
    const source = asset("./okfilow.js").toString();
    const tray = source.slice(source.indexOf("function buildTray()"), source.indexOf("function refreshTray()"));
    expect(tray).toMatch(/process\.platform === "win32"\s*\? path\.join\(__dirname, "build", "icon\.ico"\)/);
  });

  it("announces startup status updates through the splash live region", () => {
    expect(asset("./splash.html").toString()).toMatch(/<[^>]*id="status"[^>]*role="status"[^>]*>/);
  });
});

it("skips Windows legacy folder lookup on an isolated profile", () => {
  const source = asset("./main.js").toString();
  const lookup = source.indexOf('app.getPath("appData")');
  expect(lookup).toBeGreaterThan(source.indexOf("if (process.env.FILOW_USER_DATA_DIR) return false;"));
});
