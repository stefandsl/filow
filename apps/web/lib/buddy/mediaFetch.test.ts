import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commonsBase, commonsQuery, download, fromCommons, fromOwn, pickCommons, uploadAllowed } from "./mediaFetch";
import { lookUpMedia, lookupPath, readAnswer } from "./mediaClient";
import type { Recipient } from "./outbound";

const GIF_BYTES = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");
const BASE = "https://commons.wikimedia.org";
const page = (o: Record<string, unknown>) => ({ index: 1, title: "File:Heart beat.gif", imageinfo: [{ url: "https://upload.wikimedia.org/a/Heart.gif", mime: "image/gif", size: 1000, extmetadata: { Artist: { value: '<a href="x">Jane Doe</a>' }, LicenseShortName: { value: "CC BY-SA 4.0" } }, ...o }] });

describe("Commons", () => {
  it("asks only for files of the kind, with author, licence and size", () => {
    const q = new URL(commonsQuery(BASE, "video", "Solar eclipse"));
    expect(q.origin).toBe(BASE);
    expect(q.searchParams.get("gsrsearch")).toBe("Solar eclipse filemime:video/webm");
    expect(q.searchParams.get("iiextmetadatafilter")).toContain("LicenseShortName");
  });
  it("takes the first file with an author and a licence, from Wikimedia's upload host, small and short enough", () => {
    const ok = pickCommons({ query: { pages: { 1: page({}) } } }, "gif", BASE);
    expect(ok).toEqual({ url: "https://upload.wikimedia.org/a/Heart.gif", caption: "Heart beat", source: "Wikimedia Commons · Jane Doe · CC BY-SA 4.0" });
    expect(pickCommons({ query: { pages: { 1: page({ extmetadata: { Artist: { value: "x" } } }) } } }, "gif", BASE)).toBeNull();
    expect(pickCommons({ query: { pages: { 1: page({ url: "https://evil.example/x.gif" }) } } }, "gif", BASE)).toBeNull();
    expect(pickCommons({ query: { pages: { 1: page({ size: 9_000_000 }) } } }, "gif", BASE)).toBeNull();
    expect(pickCommons({ query: { pages: { 1: page({ mime: "video/webm", duration: 300 }) } } }, "video", BASE)).toBeNull();
    expect(pickCommons({ query: { pages: { 1: page({ mime: "video/webm" }) } } }, "video", BASE)).toBeNull(); // no length: not shown
    expect(pickCommons({ query: { pages: { 1: page({ mime: "video/webm", duration: 12, url: "https://upload.wikimedia.org/v.webm" }) } } }, "video", BASE)?.url).toBe("https://upload.wikimedia.org/v.webm");
  });
  it("a fake Commons on this PC only in development and QA runs, never in a released build or off loopback", () => {
    expect(commonsBase({ FILOW_QA_COMMONS_URL: "http://127.0.0.1:5032/", NODE_ENV: "development" })).toBe("http://127.0.0.1:5032");
    expect(commonsBase({ FILOW_QA_COMMONS_URL: "http://127.0.0.1:5032", NODE_ENV: "production" })).toBe(BASE);
    expect(commonsBase({ FILOW_QA_COMMONS_URL: "https://evil.example", NODE_ENV: "development" })).toBe(BASE);
    expect(uploadAllowed("http://127.0.0.1:5032/f/x.gif", BASE)).toBe(false);
    expect(uploadAllowed("http://127.0.0.1:5032/f/x.gif", "http://127.0.0.1:5032")).toBe(true);
  });
  it("downloads within the cap and of the right type only; fromCommons puts it together", async () => {
    const f = (async (url: string) => {
      if (url.includes("api.php")) return new Response(JSON.stringify({ query: { pages: { 1: page({}) } } }), { headers: { "content-type": "application/json" } });
      return new Response(GIF_BYTES, { headers: { "content-type": "image/gif" } });
    }) as unknown as typeof fetch;
    const item = await fromCommons("gif", "Heart", f, {});
    expect(item?.src.startsWith("data:image/gif;base64,")).toBe(true);
    expect(item?.source).toContain("CC BY-SA 4.0");
    const html = (async () => new Response("<script>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    expect(await download("https://upload.wikimedia.org/x.gif", "gif", html)).toBeNull();
    // a file of the wrong type is not even read
    let read = 0;
    const wrong = (async () => ({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => { read++; return GIF_BYTES.buffer; } })) as unknown as typeof fetch;
    expect(await download("https://upload.wikimedia.org/x.gif", "gif", wrong)).toBeNull();
    expect(read).toBe(0);
    const big =(async () => new Response(Buffer.alloc(5_000_000), { headers: { "content-type": "image/gif" } })) as unknown as typeof fetch;
    expect(await download("https://upload.wikimedia.org/x.gif", "gif", big)).toBeNull();
  });
});

describe("the user's own", () => {
  it("reads a file on this PC within its cap, by its extension", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "filow-media-"));
    try {
      const file = path.join(dir, "loop.gif");
      fs.writeFileSync(file, GIF_BYTES);
      const item = await fromOwn(file, "Your file");
      expect(item).toMatchObject({ kind: "gif", caption: "loop", source: "Your file" });
      fs.writeFileSync(path.join(dir, "notes.txt"), "x");
      expect(await fromOwn(path.join(dir, "notes.txt"), "Your file")).toBeNull();
      expect(await fromOwn(path.join(dir, "missing.gif"), "Your file")).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the panel's lookups", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  const deps = (answer: "granted" | "declined", seen: string[], asked: Recipient[], sent: Recipient[]) => ({
    offline: false,
    allow: async (r: Recipient) => { asked.push(r); return answer; },
    sending: async <T,>(r: Recipient, run: (h: Record<string, string>) => Promise<T>) => { sent.push(r); return run({ "x-filow-consent": `photo:${r.id}` }); },
    get: async (p: string, h: Record<string, string>) => { seen.push(`${p} ${h["x-filow-consent"] ?? "-"}`); return p.includes("/photo") ? { dataUrl: PNG, source: "Wikipedia" } : { item: { kind: p.includes("kind=gif") ? "gif" : "gif", src: GIF, caption: "c", source: "Wikimedia Commons · A · CC0" } }; },
    ownLabel: "Your file",
  });
  it("one yes for the whole batch, naming one source; every lookup carries it; order kept", async () => {
    const seen: string[] = []; const asked: Recipient[] = []; const sent: Recipient[] = [];
    const r = await lookUpMedia([{ kind: "photo", subject: "Heart" }, { kind: "gif", subject: "Heart beating" }, { kind: "photo", subject: "Lung" }, { kind: "photo", subject: "Brain" }], deps("granted", seen, asked, sent));
    expect(asked.map((x) => x.id)).toEqual(["wikimedia"]);
    expect(sent.map((x) => x.id)).toEqual(["wikimedia"]);
    expect(seen.every((s) => s.endsWith("photo:wikimedia"))).toBe(true);
    expect(r.items.map((x) => x?.kind)).toEqual(["photo", "gif", "photo", "photo"]);
  });
  it("a no sends nothing and says why; own files on this PC need no yes", async () => {
    const seen: string[] = []; const asked: Recipient[] = []; const sent: Recipient[] = [];
    const r = await lookUpMedia([{ kind: "photo", subject: "Heart" }, { kind: "gif", subject: "C:\\x\\a.gif", own: true }, { kind: "gif", subject: "http://127.0.0.1:5033/a.gif", own: true }], deps("declined", seen, asked, sent));
    expect(r.declined).toBe(true);
    expect(sent).toEqual([]);
    expect(seen.map((s) => s.split(" ")[0])).toEqual(["/api/buddy/media?own=C%3A%5Cx%5Ca.gif&label=Your%20file", "/api/buddy/media?own=http%3A%2F%2F127.0.0.1%3A5033%2Fa.gif&label=Your%20file"]);
  });
  it("a link to another site asks for that site; offline mode sends nothing to the web", async () => {
    const seen: string[] = []; const asked: Recipient[] = []; const sent: Recipient[] = [];
    await lookUpMedia([{ kind: "gif", subject: "https://example.org/a.gif", own: true }], deps("granted", seen, asked, sent));
    expect(asked.map((x) => x.id)).toEqual(["link:example.org"]);
    const seen2: string[] = [];
    const off = { ...deps("granted", [], [], []), offline: true, get: async (p: string): Promise<unknown> => { seen2.push(p); return null; } };
    await lookUpMedia([{ kind: "photo", subject: "Heart" }, { kind: "gif", subject: "https://example.org/a.gif", own: true }], off);
    expect(seen2).toEqual([]);
  });
  it("routes and answers", () => {
    expect(lookupPath({ kind: "photo", subject: "cuore" }, "x", "it")).toBe("/api/buddy/photo?q=it%2Fcuore");
    expect(lookupPath({ kind: "video", subject: "Eclipse" }, "x")).toBe("/api/buddy/media?kind=video&q=Eclipse");
    expect(readAnswer({ kind: "photo", subject: "Heart" }, { dataUrl: GIF })).toMatchObject({ kind: "gif", caption: "Heart", source: "Wikipedia" });
    expect(readAnswer({ kind: "photo", subject: "Heart" }, { dataUrl: "data:text/html;base64,AA==" })).toBeNull();
  });
});
