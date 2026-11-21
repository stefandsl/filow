import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {EventEmitter} from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { DEFAULTS, SPELLINGS, blocked, combine, createCombiner, checkRecording, captureAllowed } = require("./wake-policy");
const { verify, ensureModels, FILES } = require("./wake-models");
const { createWake, wav, readSample } = require("./wake");
const { createDetectors } = require("./wake");
const { pillLive } = require("./okfilow-stop");
const thresholds = { loose: 1, sensitive: 3, sure: 5 };
const verification = { balanced: { total: 5, recognised: 5, negatives: 0, negativeAccepts: 0 } };
const ready = { enabled: true, assistantEnabled: true, models: true, trained: true, indicator: true, mode: "idle", sinceSpeechMs: 600 };
const dirs: string[] = [];
function temp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "wake-test-")); dirs.push(d); return d; }
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
it('uses one utility RPC for both scores, reset and cleanup',async()=>{
 const child=Object.assign(new EventEmitter(),{postMessage:vi.fn((m:{id:number;type:string;at:number})=>queueMicrotask(()=>child.emit('message',{id:m.id,at:m.at,score:6,keyword:true,ms:2}))),kill:vi.fn()});
 const utilityProcess={fork:vi.fn(()=>child)};
 const dir = temp();
 const detector=await createDetectors(dir,{},utilityProcess);
 const legacy = fs.readFileSync(path.join(dir, "keywords.txt"), "utf8");
 expect(legacy).toContain("OW2 K EY1 F IY1 L OW0 :");
 expect(legacy).not.toMatch(/^F IY1 L OW0 :/m);
 expect(utilityProcess.fork).toHaveBeenCalledTimes(1);
 expect(await detector.feed(new Float32Array(1600),100)).toMatchObject({score:6,keyword:true,at:100});
 await detector.reset();expect(child.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'reset'}));
 detector.stop();expect(child.kill).toHaveBeenCalledOnce();
});
it('blocks legacy profiles without replay evidence before loading detectors',async()=>{
 const dir=temp();fs.mkdirSync(path.join(dir,'wake'));
 fs.writeFileSync(path.join(dir,'wake/profile.json'),JSON.stringify({version:1,weights:Array(1152).fill(0),bias:0,thresholds,models:FILES.map((f:{sha256:string})=>f.sha256).join(':')}));
 const load=vi.fn();const wake=createWake({userData:dir,state:()=>ready,changed:()=>{},detected:()=>{},verifyModelsFn:async()=>{},createDetectorsFn:load});
 await wake.enable('balanced');expect(wake.status().enabled).toBe(false);expect(wake.status().error).toContain('Replay check required');expect(load).not.toHaveBeenCalled();
});
it('stores only explicitly accepted personal negatives, supports skipping and invalidates the head',()=>{
 const dir=temp(),wake=createWake({userData:dir,state:()=>ready,changed:()=>{},detected:()=>{}});
 const audio=Float32Array.from({length:16000},(_,i)=>.1*Math.sin(i/8));
 expect(()=>wake.negative(2,audio)).toThrow('Invalid personal negative');
 expect(()=>wake.negative(0,new Float32Array(16000))).toThrow('quiet');
 wake.negative(0,audio);wake.negative(1,audio);expect(wake.status().negatives).toBe(2);expect(wake.status().trained).toBe(false);
 wake.negative(0,null);expect(wake.status().negatives).toBe(1);
 wake.remove();expect(fs.existsSync(path.join(dir,'wake'))).toBe(false);
});
describe("wake privacy defaults", () => {
  it("requires opt-in, five recordings and one thread", () => {
    expect(DEFAULTS.enabled).toBe(false); expect(DEFAULTS.recordings).toBe(5); expect(DEFAULTS.threads).toBe(1);
    expect(DEFAULTS.bundleModels).toBe(false); expect(DEFAULTS.retainRecordings).toBe(true);
    expect(DEFAULTS.followUpMs).toBe(0); expect(DEFAULTS.interruptSpeech).toBe(false);
    expect(DEFAULTS.phrase).toBe("Filow");
    expect(SPELLINGS).toEqual(expect.arrayContaining([
      "F IY1 L OW0", "F IH1 L AO1", "F IY0 L OW1", "OW2 K EY1 F IY1 L OW0", "HH EY1 F IY1 L OW0",
    ]));
    expect(new Set(SPELLINGS).size).toBe(SPELLINGS.length);
    const worker = fs.readFileSync(path.join(__dirname, "wake-worker.js"), "utf8");
    const head = fs.readFileSync(path.join(__dirname, "wake-head.js"), "utf8");
    expect(worker).toContain("numThreads: 1");
    expect(head).toContain('intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential"');
  });
  it.each(["strict", "balanced", "sensitive"])("%s has its own decision boundary", (mode) => {
    const expected = mode === "strict" ? [false, true, false, false] : mode === "balanced" ? [false, true, false, true] : [false, false, true, true];
    expect([[2, false], [2, true], [4, false], [6, false]].map(([score, spot]) => combine(mode, score, spot, thresholds))).toEqual(expected);
    expect(combine(mode, NaN, true, thresholds)).toBe(false);
    expect(combine(mode, 50, true, { loose: 7, sensitive: 3, sure: 5 })).toBe(false);
  });
  it.each(["strict", "balanced", "sensitive"])("requires a prefix even for a confident %s head when opted out", mode => {
    const keywords = require("./wake-policy").keywordText({ phrase: "Filow", requirePrefix: true });
    expect(keywords).not.toMatch(/^F /m);
    expect(keywords).toMatch(/^HH EY1 F IY1 L OW0 :1 #0\.4 /m);
    const combiner = createCombiner(thresholds, mode, true);
    expect(combiner.push({ at: 100, score: 99 })).toBe(false);
    expect(combiner.push({ at: 200, keyword: true })).toBe(true);
  });
  it("matches by audio time, expires agreement, resets and debounces", () => {
    const c = createCombiner(thresholds, "strict");
    expect(c.push({ at: 100, score: 2 })).toBe(false);
    expect(c.push({ at: 200, keyword: true })).toBe(true);
    expect(c.push({ at: 300, score: 10, keyword: true })).toBe(false);
    c.reset();
    expect(c.push({ at: 0, keyword: true })).toBe(false);
    expect(c.push({ at: 1300, score: 2 })).toBe(false);
  });
  it.each([
    [{ enabled: false }, "off"], [{ assistantEnabled: false }, "off"], [{ take: true }, "take"],
    [{ slideshow: true }, "slideshow"], [{ eyeClosed: true }, "eye"], [{ paused: true }, "paused"],
    [{ locked: true }, "locked"], [{ mode: "speaking" }, "busy"], [{ mode: "thinking" }, "busy"],
    [{ mode: "opening" }, "busy"], [{ handsFree: true }, "busy"], [{ dictation: true }, "busy"],
    [{ indicator: false }, "indicator"], [{ models: false }, "models"], [{ trained: false }, "enrol"],
    [{ sinceSpeechMs: 599 }, "speech"], [{ light: true, downloading: true }, "busy"],
  ])("blocks capture for %j", (change, reason) => {
    expect(blocked(ready)).toBe(""); expect(blocked({ ...ready, ...change })).toBe(reason);
    expect(captureAllowed("wake", { ...ready, ...change, wakeListening: true })).toBe(false);
  });
  it("idle pill remains clickable; question and wake permissions do not leak", () => {
    expect(pillLive("idle", { hears: true })).toBe(true);
    expect(pillLive("idle", { hears: false })).toBe(false);
    expect(captureAllowed("wake", { ...ready, wakeListening: true })).toBe(true);
    expect(captureAllowed("question", { ...ready, wakeListening: true })).toBe(false);
    expect(captureAllowed("question", { wakeQuestion: true })).toBe(true);
    expect(captureAllowed("wake", { ...ready, wakeQuestion: true })).toBe(false);
  });
});
describe("enrolment and downloads", () => {
  it("rejects short, quiet, clipped and nonfinite takes", () => {
    expect(checkRecording(new Float32Array(100))).toBe("short");
    expect(checkRecording(new Float32Array(32000))).toBe("quiet");
    expect(checkRecording(new Float32Array(32000).fill(1))).toBe("clipped");
    expect(checkRecording(new Float32Array(32000).fill(NaN))).toBe("invalid");
    const x = Float32Array.from({ length: 32000 }, (_, i) => 0.1 * Math.sin(i / 8));
    expect(checkRecording(x)).toBe("");
    const f = path.join(temp(), "test.wav"); fs.writeFileSync(f, wav(x));
    expect(readSample(f)[123]).toBeCloseTo(x[123], 4);
  });
  it("checks both pinned length and hash, rejects tampering", async () => {
    const f = path.join(temp(), "model"), data = Buffer.from("official model fixture"); fs.writeFileSync(f, data);
    const entry = { bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
    await expect(verify(f, entry)).resolves.toBeUndefined();
    fs.writeFileSync(f, Buffer.alloc(data.length)); await expect(verify(f, entry)).rejects.toThrow("checksum");
    fs.writeFileSync(f, data.subarray(1)); await expect(verify(f, entry)).rejects.toThrow("checksum");
  });
  it("never downloads while off or before consent", async () => {
    const fetchFile = vi.fn(); const dir = temp();
    await expect(ensureModels(dir, { enabled: false, consent: true, fetchFile })).rejects.toThrow("consent");
    await expect(ensureModels(dir, { enabled: true, consent: false, fetchFile })).rejects.toThrow("consent");
    expect(fetchFile).not.toHaveBeenCalled(); expect(fs.readdirSync(dir)).toEqual([]);
  });
  it("listening uses no network and persists no audio; pause clears authorization", async () => {
    const dir = temp(); fs.mkdirSync(path.join(dir, "wake"));
    fs.writeFileSync(path.join(dir, "wake/profile.json"), JSON.stringify({ version: 1, weights: Array(1152).fill(0), bias: 0, thresholds, verification, models: FILES.map((f: { sha256: string }) => f.sha256).join(":") }));
    const network = vi.fn(() => { throw new Error("network during listening"); });
    vi.spyOn(globalThis, "fetch").mockImplementation(network);
    vi.spyOn(require("node:https"), "get").mockImplementation(network);
    vi.spyOn(require("node:http"), "get").mockImplementation(network);
    vi.spyOn(require("node:net"), "connect").mockImplementation(network);
    let conditions = { ...ready };
    const wake = createWake({ userData: dir, state: () => conditions, changed: vi.fn(), detected: vi.fn(), verifyModelsFn: async () => {}, ensureModelsFn: network,
      createDetectorsFn: async () => ({ feed: async (_samples: unknown, at: number) => ({ at, score: -1, keyword: false, ms: 1 }), reset: async () => {}, stop: vi.fn() }) });
    expect(wake.status()).toMatchObject({ enabled: false, legacyPhrase: true });
    const oldSamples = path.join(dir, "wake", "samples");
    fs.mkdirSync(oldSamples);
    fs.writeFileSync(path.join(oldSamples, "1.wav"), wav(new Float32Array(16000)));
    expect(wake.status().recordings).toBe(0);
    await wake.enable("balanced"); expect(wake.status().listening).toBe(true);
    for (let i = 0; i < 30; i++) await wake.feed(new Float32Array(1600));
    expect(network).not.toHaveBeenCalled(); expect(fs.readdirSync(path.join(dir, "wake"))).toEqual(["profile.json", "samples"]);
    conditions = { ...ready, indicator: false }; wake.reconcile(); expect(wake.status().listening).toBe(false);
    const fresh = Float32Array.from({length:16000}, (_, i) => .1 * Math.sin(i/8));
    expect(wake.sample(0, fresh)).toMatchObject({ recordings: 1, trained: true, legacyPhrase: true });
    expect(fs.existsSync(path.join(dir, "wake", "profile.json"))).toBe(true);
    wake.remove(); expect(fs.existsSync(path.join(dir, "wake"))).toBe(false); expect(wake.status().enabled).toBe(false);
  });
  it("discards an inference finishing after pause and resume", async () => {
    const dir = temp(); fs.mkdirSync(path.join(dir, "wake"));
    fs.writeFileSync(path.join(dir, "wake/profile.json"), JSON.stringify({ version: 1, weights: Array(1152).fill(0), bias: 0, thresholds, verification, models: FILES.map((f: { sha256: string }) => f.sha256).join(":") }));
    let paused = false, defer = false;
    let complete!: (r: unknown) => void;
    const detected = vi.fn();
    const wake = createWake({ userData: dir, state: () => ({ ...ready, paused }), changed: vi.fn(), detected,
      verifyModelsFn: async () => {}, createDetectorsFn: async () => ({ feed: async (_s: unknown, at: number) => defer ? new Promise((r) => { complete = r; }) : { at, score: -1, ms: 1 }, reset: async () => {}, stop: vi.fn() }) });
    await wake.enable("balanced"); defer = true;
    const old = wake.feed(new Float32Array(1600));
    paused = true; await wake.reconcile(); expect(wake.status().listening).toBe(false);
    paused = false; await wake.reconcile(); expect(wake.status().listening).toBe(true);
    complete({ at: 100, score: 99, keyword: true, ms: 1 }); await old;
    expect(detected).not.toHaveBeenCalled(); wake.stop();
  });
});
it("keeps a legacy profile and its recordings until a replacement passes replay", async () => {
  const dir = temp(), root = path.join(dir, "wake"), old = path.join(root, "samples");
  fs.mkdirSync(old, { recursive: true });
  const file = path.join(root, "profile.json");
  const legacy = { version: 1, weights: Array(1152).fill(0), bias: 0, thresholds, verification,
    models: FILES.map((f: { sha256: string }) => f.sha256).join(":") };
  const bytes = JSON.stringify(legacy);
  fs.writeFileSync(file, bytes);
  const pcm = Float32Array.from({ length: 16000 }, (_, i) => .1 * Math.sin(i / 8));
  for (const name of ["1", "2", "3", "4", "5", "negative-1"]) fs.writeFileSync(path.join(old, name + ".wav"), wav(pcm));
  let score = -100;
  const load = vi.fn(async () => ({ feed: async (_pcm: unknown, at: number) => ({ at, score, keyword: true, ms: 1 }),
    reset: async () => {}, stop: vi.fn() }));
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), postMessage(m: { id: number }) {
    queueMicrotask(() => child.emit("message", { id: m.id, profile: legacy }));
  } });
  const wake = createWake({ userData: dir, state: () => ready, changed: vi.fn(), detected: vi.fn(),
    verifyModelsFn: async () => {}, utilityProcess: { fork: () => child }, createDetectorsFn: load });
  for (let i = 0; i < 5; i++) wake.sample(i, pcm);
  expect(await wake.train("balanced")).toMatchObject({ legacyPhrase: true, error: expect.stringContaining("Replay check") });
  expect(fs.readFileSync(file, "utf8")).toBe(bytes);
  expect(fs.readdirSync(old)).toHaveLength(6);
  expect(await wake.enable("balanced", false)).toMatchObject({ listening: true });
  expect(load).toHaveBeenLastCalledWith(expect.any(String), { ...legacy, requirePrefix: false }, expect.anything());
  score = 100;
  expect(await wake.train("balanced")).toMatchObject({ legacyPhrase: false, recordings: 5, error: "" });
  expect(fs.existsSync(old)).toBe(false);
  expect(JSON.parse(fs.readFileSync(file, "utf8")).phrase).toBe("Filow");
});

it("excludes the unprefixed English word hero from new keywords", () => {
  expect(SPELLINGS).not.toContain("HH IY1 R OW0");
});
