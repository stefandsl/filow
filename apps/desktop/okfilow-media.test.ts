import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Item = { kind: string; src: string; caption: string; source: string };
type Show = { x: number; y: number; gallery: Item[]; slide: { title: string; points: string[]; media: Item[] } | null };
const { cleanShow, showFor, maxDataUrl } = require("./okfilow-media.js") as { cleanShow: (r: unknown) => Show | null; showFor: (s: Show | null, b: { x: number; y: number; width: number; height: number }) => Show | null; maxDataUrl: (k: string) => number };
const { overlayMouse } = require("./okfilow-stop.js") as { overlayMouse: (o: Record<string, unknown>) => { ignore: boolean } };
const web = await import("../web/lib/buddy/media");

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const WEBM = "data:video/webm;base64,GkXfo59ChoEB";

describe("main passes on only what may be shown", () => {
  it("data URLs of their kind within their caps, at most six pictures and a slide with three", () => {
    const s = cleanShow({ x: 100, y: 50, gallery: [...Array(8)].map(() => ({ kind: "photo", src: PNG, caption: "c", source: "s" })), slide: { title: "T", points: ["a", "b"], media: [{ kind: "gif", src: GIF }, { kind: "video", src: WEBM }, { kind: "video", src: WEBM }, { kind: "gif", src: GIF }] } });
    expect(s?.gallery).toHaveLength(6);
    expect(s?.slide?.media).toHaveLength(3);
    expect(cleanShow({ gallery: [{ kind: "video", src: "https://x/y.webm" }, { kind: "photo", src: GIF }, { kind: "gif", src: `data:image/gif;base64,${"A".repeat(maxDataUrl("gif"))}` }] })).toBeNull();
    expect(cleanShow({ gallery: [{ kind: "__proto__", src: PNG }] })).toBeNull();
  });
  it("says the same as the page's own check (apps/web/lib/buddy/media.ts)", () => {
    for (const k of ["photo", "gif", "video"] as const) expect(maxDataUrl(k)).toBe(web.maxDataUrl(k));
    const raw = { x: 1, y: 2, gallery: [{ kind: "gif", src: GIF, caption: "a\tb", source: "s" }, { kind: "photo", src: WEBM }], slide: { title: "T", points: ["a", "b", "c"], media: [] } };
    expect(cleanShow(raw)).toEqual(web.cleanShow(raw));
  });
  it("goes to the overlay of the display the spot is on, in its coordinates", () => {
    const s = cleanShow({ x: 2100, y: 300, gallery: [{ kind: "photo", src: PNG }] })!;
    expect(showFor(s, { x: 0, y: 0, width: 1920, height: 1080 })).toBeNull();
    expect(showFor(s, { x: 1920, y: 0, width: 1920, height: 1080 })).toMatchObject({ x: 180, y: 300 });
  });
});

describe("click-through", () => {
  it("an overlay takes the mouse while the real cursor is on a picture, at no other time", () => {
    expect(overlayMouse({ caught: false, hover: false, media: true, mode: "idle", pill: {}, bubble: false }).ignore).toBe(false);
    expect(overlayMouse({ caught: false, hover: false, media: false, mode: "idle", pill: {}, bubble: false }).ignore).toBe(true);
  });
  it("main checks the cursor against the overlay's rectangles, and Stop takes the pictures away at once", () => {
    const main = fs.readFileSync(path.join(__dirname, "okfilow.js"), "utf8");
    expect(main).toMatch(/mediaHit\(w, local\)/);
    expect(main).toMatch(/insideAny\(p, mediaRects\.get\(id\) \?\? \[\]\)/);
    expect(main).toMatch(/media: mediaOn\.has\(id\)/);
    expect(main).toMatch(/function stopAnswer[\s\S]{0,400}sendOverlays\("okfilow:media", null\)/);
    expect(main).toMatch(/const pinned = \(\) => cardsUp \|\| mediaUp/);
  });
});
