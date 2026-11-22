import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const load = createRequire(import.meta.url);

describe("packaged Windows feedback", () => {
  it("supplies a multi-resolution image for the Windows tray", () => {
    const { trayImage } = load("./tray-image");
    const ico = readFileSync(trayImage("win32", fileURLToPath(new URL(".", import.meta.url))));
    const widths = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
    expect(widths).toEqual(expect.arrayContaining([16, 32]));
  });

  it("updates the status exposed to assistive technology", () => {
    const { parse } = load("next/dist/compiled/node-html-parser");
    const doc = parse(readFileSync(new URL("./splash.html", import.meta.url), "utf8"));
    const window = {} as { setStatus(text: string, done: boolean): void };
    doc.querySelector("#badge").replaceChildren = () => {};
    const document = {
      documentElement: { dataset: {} }, getElementById: (id: string) => doc.querySelector("#" + id),
      createElement: (tag: string) => parse("<" + tag + "></" + tag + ">").firstChild,
      createTextNode: (text: string) => text,
    };
    runInNewContext(doc.querySelector("script").textContent, { window, document, URLSearchParams, location: { search: "" } });
    window.setStatus("Ready", true);
    expect(doc.querySelector('[role="status"]').textContent).toBe("Ready");
  });
});
