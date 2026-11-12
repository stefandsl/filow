import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// about-page.js is a browser script (no exports). It runs here in a vm against a small fake DOM, so the
// About page's version line is the one the page really builds from the about:data payload.
type FakeNode = {
  tag: string; className: string; textContent: string; children: unknown[]; dataset: Record<string, string>;
  classList: { toggle(): void }; setAttribute(): void; removeAttribute(): void; addEventListener(): void;
  append(...k: unknown[]): void; replaceChildren(...k: unknown[]): void; querySelector(): null; querySelectorAll(): unknown[]; focus(): void;
};
function node(tag = "div"): FakeNode {
  const n: FakeNode = {
    tag, className: "", textContent: "", children: [], dataset: {}, classList: { toggle() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], focus() {},
    append(...k) { n.children.push(...k); },
    replaceChildren(...k) { n.children = k; },
  };
  return n;
}
const textOf = (n: unknown): string => (typeof n === "string" ? n : n && typeof n === "object" ? (n as FakeNode).textContent + (n as FakeNode).children.map(textOf).join("") : "");
const find = (n: unknown, cls: string): FakeNode | null => {
  if (!n || typeof n !== "object") return null;
  const f = n as FakeNode;
  if (f.className === cls) return f;
  for (const c of f.children) { const r = find(c, cls); if (r) return r; }
  return null;
};

async function renderAbout(data: Record<string, unknown>): Promise<FakeNode> {
  const main = node("main");
  const documentElement = node("html");
  const document = {
    getElementById: (id: string) => (id === "main" ? main : node()),
    createElement: (t: string) => node(t),
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement,
    title: "",
  };
  const api = {
    data: async () => data, onView() {}, openConfigFolder: async () => {}, close: async () => {},
  };
  const window = { filowAbout: api, scrollTo() {} };
  runInNewContext(readFileSync(path.join(__dirname, "about-page.js"), "utf8"), { window, document, location: { hash: "" }, HTMLTextAreaElement: class {}, setTimeout, clearTimeout });
  await new Promise((r) => setTimeout(r, 0));
  return main;
}

describe("the About page's version line (about-page.js)", () => {
  const text = new Proxy({ version: "Version {version}" } as Record<string, string>, { get: (t, k: string) => t[k] ?? k });
  const payload = {
    lang: "en", theme: "dark", view: "about", text, policy: [], policyLang: "en",
    info: { version: "0.9.32", electron: "41.0.0", configFolder: "C:\\cfg" },
    buildLabel: "build 616c707",
  };

  it("shows the version, the Electron version and the build label from the payload", async () => {
    const line = find(await renderAbout(payload), "version");
    expect(line, "the page has no version line").not.toBeNull();
    const shown = textOf(line);
    expect(shown).toContain("Version 0.9.32");
    expect(shown).toContain("Electron 41.0.0");
    expect(shown).toContain("build 616c707");
  });

  it("shows whatever label the payload carries", async () => {
    const shown = textOf(find(await renderAbout({ ...payload, buildLabel: "Build 1234abc (dev)" }), "version"));
    expect(shown).toContain("Build 1234abc (dev)");
    expect(shown).not.toContain("616c707");
  });
});
