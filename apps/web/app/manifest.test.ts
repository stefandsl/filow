import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import manifest from "./manifest";

const publicDir = path.resolve(__dirname, "../public");
/** Width and height from a PNG's IHDR chunk. */
const pngSize = (file: string) => { const b = fs.readFileSync(file); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };

it("meets Chrome's install criteria for the phone mirror (name, standalone, start_url inside scope)", () => {
  const m = manifest();
  expect(m.name && m.short_name).toBeTruthy();
  expect(m.display).toBe("standalone");
  expect(m.id).toBe("/mirror");
  expect(m.start_url).toBe("/mirror");
  // Scoped to the mirror, so desktop pages are never offered as the installed app.
  expect(m.scope).toBe("/mirror");
  expect(String(m.start_url).startsWith(String(m.scope))).toBe(true);
  expect(m.prefer_related_applications).not.toBe(true);
});

it("paints the splash and title bar in the app's own dark background, read from the theme tokens", () => {
  const tokens = fs.readFileSync(path.resolve(__dirname, "theme-tokens.css"), "utf8");
  const darkBg = tokens.match(/:root\s*\{[^}]*--bg:\s*(#[0-9a-f]{6})/i)?.[1];
  expect(darkBg).toBeTruthy();
  expect(manifest().background_color).toBe(darkBg);
  expect(manifest().theme_color).toBe(darkBg);
});

it("ships every icon it declares, at the declared size, with 192 and 512 px in both any and maskable", () => {
  const icons = manifest().icons ?? [];
  for (const i of icons) expect(pngSize(path.join(publicDir, i.src)), i.src).toBe(i.sizes);
  for (const purpose of ["any", "maskable"]) for (const size of ["192x192", "512x512"]) {
    expect(icons.some((i) => i.purpose === purpose && i.sizes === size), `${purpose} ${size}`).toBe(true);
  }
  expect(pngSize(path.join(publicDir, "apple-touch-icon.png"))).toBe("180x180");
});

it("has a single manifest: a static public/manifest.webmanifest would shadow app/manifest.ts", () => {
  expect(fs.existsSync(path.join(publicDir, "manifest.webmanifest"))).toBe(false);
});
