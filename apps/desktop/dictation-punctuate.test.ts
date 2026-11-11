// Punctuation and capitals for Italian, Russian, Romanian and Japanese dictations (dictation-punctuate.js,
// truecase-text.js, truecase-runtime.js). No model here: its answers (pieces and labels) are given by hand.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const tc = require("./truecase-text.js");
const { wanted, combine, createPunctuator, LANGS } = require("./dictation-punctuate.js");
const { createTruecaseRuntime, FILES, BYTES, REVISION } = require("./truecase-runtime.js");

const P = "▁"; // the tokenizer's mark for a space
/** Pieces one per word, the way the tokenizer gives them, and a label per piece. */
const words = (text: string) => tc.lowerKeepLength(tc.stripMarks(text)).split(" ").map((w: string, i: number) => (i ? P + w : w));

describe("punctuation model: the text going in", () => {
  it("takes the marks out but keeps the ones inside numbers", () => {
    expect(tc.stripMarks("Alle 9.30, poi 1,000 euro?  Alle 10:30!")).toBe("Alle 9.30 poi 1,000 euro Alle 10:30");
    expect(tc.stripMarks("こんにちは、田中です。")).toBe("こんにちは田中です");
    expect(tc.lowerKeepLength("Иван İ NATO")).toBe("иван İ nato"); // a letter whose lower case is longer stays
  });
});

describe("punctuation model: labels to text", () => {
  it("adds the mark after the word and the capital on it", () => {
    expect(tc.applyLabels("ciao come stai", words("ciao come stai"), [",|Cap", "0|lower", "?|lower"], "it")).toBe("Ciao, come stai?");
    expect(tc.applyLabels("я работаю в оон", words("я работаю в оон"), ["0|Cap", "0|lower", "0|lower", ".|UPPER"], "ru")).toBe("Я работаю в ООН.");
  });
  it("a label inside a word does not count; the word's last piece decides", () => {
    expect(tc.applyLabels("buongiorno a tutti", ["buon", "giorno", `${P}a`, `${P}tutti`], [".|Cap", "0|lower", "0|lower", ".|lower"], "it")).toBe("buongiorno a tutti.");
    expect(tc.applyLabels("buongiorno a tutti", ["buon", "giorno", `${P}a`, `${P}tutti`], ["0|lower", ",|Cap", "0|lower", ".|lower"], "it")).toBe("Buongiorno, a tutti.");
  });
  it("Japanese: after any character, full-width, with the Japanese comma, and no dash", () => {
    expect(tc.applyLabels("こんにちは田中です", ["こんにちは", "田中", "です"], [",|lower", "-|lower", ".|lower"], "ja")).toBe("こんにちは、田中です。");
    expect(tc.applyLabels("誰が書きましたか", ["誰が", "書きましたか"], ["0|lower", "?|lower"], "ja")).toBe("誰が書きましたか？");
  });
  it("writes only full stop, comma and question mark: the model's colon and dash are left out", () => {
    expect(tc.applyLabels("uno due tre", words("uno due tre"), [":|lower", "-|lower", ".|lower"], "it")).toBe("uno due tre.");
  });
  it("pieces that do not spell the text: nothing is applied", () => {
    expect(tc.applyLabels("ciao come stai", ["ciao", `${P}come`], ["0|Cap", ".|lower"], "it")).toBeNull();
    expect(tc.applyLabels("ciao come stai", ["ciao", `${P}como`, `${P}stai`], ["0|Cap", "0|lower", ".|lower"], "it")).toBeNull();
    expect(tc.applyLabels("ciao come", words("ciao come"), ["0|Cap"], "it")).toBeNull();
  });
});

describe("punctuation model: laid over what the recognizer wrote", () => {
  it("the recognizer's marks and capitals stay; the model fills what is missing", () => {
    expect(tc.merge("Come pensi, vale la pena aspettare", "Come pensi. Vale la pena aspettare?")).toBe("Come pensi, vale la pena aspettare?");
    expect(tc.merge("Завтра я иду в Казань. Вернусь вечером", "завтра я иду в казань, вернусь вечером.")).toBe("Завтра я иду в Казань. Вернусь вечером.");
  });
  it("no capital after a comma, the model's known weak spot; an acronym there is still raised", () => {
    expect(tc.merge("buongiorno mi chiamo marco", "Buongiorno, Mi chiamo Marco.")).toBe("Buongiorno, mi chiamo Marco.");
    expect(tc.merge("включая ндс", "включая, НДС.")).toBe("включая, НДС.");
  });
  it("a recognizer that writes capitals itself keeps its casing inside the sentence", () => {
    const restored = "Riunione è alle 9 e 30 in Sala Grande. Poi Basta.";
    expect(tc.merge("riunione è alle 9 e 30 in sala grande poi basta", restored, { sentenceStartsOnly: true })).toBe("Riunione è alle 9 e 30 in sala grande. Poi basta.");
    expect(tc.merge("riunione è alle 9 e 30 in sala grande poi basta", restored)).toBe(restored);
  });
  it("other words: nothing is merged", () => {
    expect(tc.merge("ciao come stai", "Ciao come va?")).toBeNull();
    expect(tc.merge("ciao come stai", "Ciao come stai bene?")).toBeNull();
    expect(tc.merge("ciao come stai bene", "Ciao come stai?")).toBeNull();
  });
});

describe("punctuation: which dictations, and never another word", () => {
  it("only Italian, Russian, Romanian and Japanese, only when on, only when the sentence was left open", () => {
    expect(LANGS).toEqual(["it", "ru", "ro", "ja"]);
    expect(wanted("ciao come stai", { language: "it" })).toMatchObject({ ok: true, lang: "it" });
    expect(wanted("ciao come stai", { language: "auto", spokenLanguage: "ru" })).toMatchObject({ ok: true, lang: "ru" });
    expect(wanted("hello there", { language: "en" })).toMatchObject({ ok: false, reason: "language en" }); // English has S1-mini
    expect(wanted("hallo", { language: "auto", spokenLanguage: "" })).toMatchObject({ ok: false, reason: "language unknown" });
    expect(wanted("Ciao, come stai?", { language: "it" })).toMatchObject({ ok: false, reason: "already punctuated" }); // Parakeet writes its own
    expect(wanted("行きます。", { language: "ja" })).toMatchObject({ ok: false, reason: "already punctuated" });
    expect(wanted("ciao", { language: "it", enabled: false })).toMatchObject({ ok: false, reason: "off" });
  });
  it("the combined text has the same letters and digits, whatever the labels say", () => {
    const said = "Buongiorno, mi chiamo Marco e ho 25 anni";
    const pieces = words(said);
    for (const label of ["0|lower", ".|Cap", ",|UPPER", "?|Cap", "-|UPPER", ":|Cap"]) {
      const out = combine(said, pieces, pieces.map(() => label), "it");
      expect(out === null || tc.skeleton(out) === tc.skeleton(said), label).toBe(true);
      expect(out === null || out.startsWith("Buongiorno,"), label).toBe(true); // the recognizer's comma and capital are still there
    }
    expect(combine(said, pieces.slice(1), pieces.slice(1).map(() => "0|lower"), "it")).toBeNull();
  });
  it("Japanese: the gap between two phrases goes when a mark fills it", () => {
    const said = "田中太郎です 東京で働いています";
    expect(combine(said, ["田中太郎です", `${P}東京で`, "働いています"], [".|lower", "0|lower", ".|lower"], "ja")).toBe("田中太郎です。東京で働いています。");
  });
});

describe("punctuation: late, failing or missing never stops a dictation", () => {
  const answer = (said: string) => ({ pieces: words(said), labels: words(said).map((_w: string, i: number, a: string[]) => (i === a.length - 1 ? ".|lower" : i === 0 ? "0|Cap" : "0|lower")) });
  it("adds the marks when the answer is in time", async () => {
    const p = createPunctuator({ run: async (lower: string) => answer(lower), ready: () => ({ ok: true, reason: "" }) });
    expect(await p.punctuate("я работаю в москве", { language: "ru" })).toMatchObject({ used: true, text: "Я работаю в москве.", asked: true });
  });
  it("without the model the words go in as they are, and the model is not asked", async () => {
    const run = vi.fn();
    const p = createPunctuator({ run, ready: () => ({ ok: false, reason: "model not on this computer" }) });
    expect(await p.punctuate("я работаю", { language: "ru" })).toMatchObject({ used: false, text: "я работаю", reason: "model not on this computer", asked: false });
    expect(await p.punctuate("I work", { language: "en" })).toMatchObject({ used: false, text: "I work", reason: "language en" });
    expect(run).not.toHaveBeenCalled();
  });
  it("a late answer is dropped; after three in a row it rests", async () => {
    const p = createPunctuator({ run: () => new Promise(() => {}), ready: () => ({ ok: true, reason: "" }), budgetMs: () => 5 });
    for (let i = 0; i < 3; i++) expect(await p.punctuate("я работаю", { language: "ru" })).toMatchObject({ used: false, text: "я работаю", reason: "slower than 5 ms" });
    expect(p.resting).toBe(true);
    expect(await p.punctuate("я работаю", { language: "ru" })).toMatchObject({ used: false, reason: "resting: too slow on this computer", asked: false });
  });
  it("an error or an answer for other words keeps the dictation as it was", async () => {
    const boom = createPunctuator({ run: async () => { throw new Error("the model's process stopped"); }, ready: () => ({ ok: true, reason: "" }) });
    expect(await boom.punctuate("я работаю", { language: "ru" })).toMatchObject({ used: false, text: "я работаю", reason: "failed: the model's process stopped" });
    const wrong = createPunctuator({ run: async () => ({ pieces: ["другие", `${P}слова`], labels: ["0|Cap", ".|lower"] }), ready: () => ({ ok: true, reason: "" }) });
    expect(await wrong.punctuate("я работаю", { language: "ru" })).toMatchObject({ used: false, text: "я работаю", reason: "not the same words" });
  });
});

describe("punctuation model: the files and the process", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const profile = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "filow-truecase-")); dirs.push(d); return d; };

  it("pins every file by size and SHA-256 at one revision", () => {
    expect(FILES.map((f: { name: string }) => f.name)).toEqual(["config.json", "tokenizer_config.json", "tokenizer.json", "model_quantized.onnx"]);
    for (const f of FILES) { expect(f.sha256).toMatch(/^[0-9a-f]{64}$/); expect(f.bytes).toBeGreaterThan(0); }
    expect(BYTES).toBe(302845219);
    expect(REVISION).toMatch(/^[0-9a-f]{40}$/);
  });
  it("downloads each file, checks its hash before it gets its name, and deletes one that differs", async () => {
    const userData = profile();
    const download = vi.fn(async (url: string, part: string) => { fs.writeFileSync(part, url); });
    let bad = "tokenizer.json";
    const rt = createTruecaseRuntime({
      userData, download, runtimeFile: () => "x", fork: () => { throw new Error("not started here"); },
      sha256File: async (file: string) => { const name = path.basename(file).replace(/\.part$/, ""); return name === bad ? "0".repeat(64) : FILES.find((f: { name: string }) => f.name === name).sha256; },
    });
    expect(await rt.fetchModel()).toBe(false);
    const dir = path.join(userData, "models", "truecase-small");
    expect(fs.readdirSync(dir).sort()).toEqual(["config.json", "tokenizer_config.json"]); // the bad file and its part are gone
    expect(rt.status()).toMatchObject({ model: false, downloading: false });
    expect(rt.status().error).toContain("hash differs");
    expect(rt.ready()).toMatchObject({ ok: false, reason: "model not on this computer" });
    bad = "";
    expect(await rt.fetchModel()).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(["config.json", "model_quantized.onnx", "tokenizer.json", "tokenizer_config.json"]);
    expect(download).toHaveBeenCalledTimes(3 + 2); // the two good files of the first try are not fetched again
    expect(download.mock.calls.every(([url, , o]) => String(url).startsWith(`https://huggingface.co/Horizon-Labs/multilingual-punctuation-truecase-small/resolve/${REVISION}/`) && (o as { resume: boolean }).resume === true)).toBe(true);
    expect(rt.status()).toMatchObject({ model: true, pct: 100 });
  });
  it("starts its process at the first dictation, answers, and gives the memory back when idle", async () => {
    const kills: number[] = [];
    let idle: (() => void) | null = null;
    const fork = vi.fn(() => {
      const c = new EventEmitter() as EventEmitter & { postMessage(m: Record<string, unknown>): void; kill(): void };
      c.postMessage = (m) => queueMicrotask(() => {
        if (m.type === "init") c.emit("message", { type: "ready", ms: 3 });
        if (m.type === "run") c.emit("message", { type: "done", id: m.id, pieces: [m.text], labels: [".|Cap"] });
      });
      c.kill = () => { kills.push(1); };
      return c;
    });
    const rt = createTruecaseRuntime({ userData: profile(), fork, runtimeFile: () => "x", modelExists: () => true, download: vi.fn(), sha256File: vi.fn(), setTimeout: (fn: () => void) => { idle = fn; return 1; }, clearTimeout: () => {} });
    expect(rt.status().running).toBe(false);
    expect(await rt.run("ciao")).toEqual({ pieces: ["ciao"], labels: [".|Cap"] });
    expect(await rt.run("ciao ciao")).toEqual({ pieces: ["ciao ciao"], labels: [".|Cap"] });
    expect(fork).toHaveBeenCalledOnce();
    expect(rt.status().running).toBe(true);
    idle!();
    expect(kills).toHaveLength(1);
    expect(rt.status()).toMatchObject({ running: false, unloads: 1 });
    await rt.run("ciao"); // the next dictation starts it again
    expect(fork).toHaveBeenCalledTimes(2);
  });
  it("a build without the runtime says so and starts nothing", async () => {
    const fork = vi.fn();
    const rt = createTruecaseRuntime({ userData: profile(), fork, runtimeFile: () => "", modelExists: () => true, download: vi.fn(), sha256File: vi.fn() });
    expect(rt.ready()).toEqual({ ok: false, reason: "runtime not in this build" });
    rt.warm();
    expect(fork).not.toHaveBeenCalled();
  });
});
