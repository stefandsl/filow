// The synthetic pointing screens (latency-screens.cjs): every stored target box must sit on the thing the
// picture draws. The P0 critic (14/11/2026) found every box about 44 px above its button (a grid of 1080 for a
// 1032 px viewport), so earlier pointing scores were measured against the wrong place. This renders the 40
// screens offscreen (no window shows) and reads the pixels inside and around each box.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { notDrawn, type Box, type Picture } from "./latency-screen-pixels";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(root, "tmp", "latency-screens-test");
const COUNT = 40;
// Electron needs a display on Linux; everywhere else it renders offscreen.
const canRender = process.platform !== "linux" || Boolean(process.env.DISPLAY);

const screens: Array<{ id: string; picture: Picture; elements: Box[]; viewport: { width: number; height: number } }> = [];

describe.skipIf(!canRender)("the 40 synthetic pointing screens", () => {
  beforeAll(async () => {
    fs.rmSync(out, { recursive: true, force: true });
    const electron = createRequire(import.meta.url)("electron") as unknown as string;
    await new Promise<void>((resolve, reject) => {
      execFile(electron, [path.join(here, "latency-screens.cjs"), out, String(COUNT)], { windowsHide: true, timeout: 150_000, env: { ...process.env, TEMP: out, TMP: out } }, (e, _o, err) => (e ? reject(new Error(`${e.message}\n${err}`)) : resolve()));
    });
    for (let n = 1; n <= COUNT; n++) {
      const id = String(n).padStart(3, "0");
      const { data, info } = await sharp(path.join(out, `${id}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const stored = JSON.parse(fs.readFileSync(path.join(out, `${id}.json`), "utf8"));
      screens.push({ id, picture: { data, width: info.width, height: info.height }, ...stored });
    }
  }, 180_000);

  it("are 1920x1080 pictures, each with the size of the viewport its grid is on", () => {
    expect(screens).toHaveLength(COUNT);
    for (const s of screens) {
      expect([s.picture.width, s.picture.height], s.id).toEqual([1920, 1080]);
      expect(s.viewport.width, s.id).toBe(1920);
      expect(s.viewport.height, s.id).toBeGreaterThan(500);
    }
  });

  it("every target box holds the button or the field the picture draws", () => {
    const wrong = screens.flatMap((s) => s.elements.map((b) => [s.id, b.name, notDrawn(b, s.picture)]).filter(([, , why]) => why));
    expect(wrong).toEqual([]);
    expect(screens.flatMap((s) => s.elements).length).toBe(COUNT * 5);
  });

  it("the same check refuses the boxes of the old generator (a grid of 1080 for the viewport)", () => {
    // only where the viewport is shorter than 1080 does the old grid differ (a window above a taskbar)
    const short = screens.filter((s) => s.viewport.height < 1070);
    const old = short.flatMap((s) => s.elements.filter((b) => b.type === "button").map((b) => notDrawn({ ...b, y1: Math.round((b.y1 * s.viewport.height) / 1080), y2: Math.round((b.y2 * s.viewport.height) / 1080) }, s.picture)));
    if (!short.length) return; // a tall display: there was no offset to find here
    expect(old.filter(Boolean).length / old.length).toBeGreaterThan(0.6);
  });
});
