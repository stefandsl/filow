// Delete a model completely (owner report 2026-11-11: "i want to be able to delete completely a model if
// downloaded") and say which model is in use ("not only installed but what actually is in use").
// Every folder here is a scratch folder; no real model folder is touched and nothing is downloaded.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { createDownloads, isInside, removeInside, sizeOf } = require("./model-files.js");
const stt = require("./stt.js");
const tts = require("./tts.js");
const { createS1Runtime } = require("./s1-runtime.js");
const { createTruecaseRuntime, FILES: TRUECASE_FILES } = require("./truecase-runtime.js");
const { createModelControl } = require("./model-control.js");
const { modelUse } = require("./model-use.js");

const root = tmpRoot("model-delete");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function profile(name: string) {
  const userData = path.join(root, name);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(path.join(userData, "models"), { recursive: true });
  return userData;
}
/** Puts a catalogue entry on disk as if it was downloaded and unpacked; `size` bytes per file. */
function install(userData: string, spec: { id: string; files: string[] }, size = 1000) {
  const dir = path.join(userData, "models", spec.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of spec.files) fs.writeFileSync(path.join(dir, f), Buffer.alloc(size, 1));
}
const names = (dir: string) => fs.readdirSync(dir).sort();

describe("the guarded delete (model-files.js removeInside)", () => {
  it("removes a folder inside the models folder and says how many bytes it held", () => {
    const models = path.join(profile("guard-ok"), "models");
    fs.mkdirSync(path.join(models, "a", "deep"), { recursive: true });
    fs.writeFileSync(path.join(models, "a", "one.bin"), Buffer.alloc(700));
    fs.writeFileSync(path.join(models, "a", "deep", "two.bin"), Buffer.alloc(300));
    expect(sizeOf(path.join(models, "a"))).toBe(1000);
    expect(removeInside(models, path.join(models, "a"))).toBe(1000);
    expect(names(models)).toEqual([]);
    expect(removeInside(models, path.join(models, "not-there"))).toBe(0);
  });

  it("refuses, and deletes nothing, for a path outside the folder it was given", () => {
    const userData = profile("guard-outside");
    const models = path.join(userData, "models");
    const precious = path.join(userData, "settings.json");
    const sibling = path.join(userData, "models-backup");
    fs.writeFileSync(precious, "{}");
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, "keep.bin"), "keep");
    for (const target of [precious, sibling, userData, models, path.join(models, ".."), path.join(models, "x", "..", "..", "settings.json"), path.resolve(root, ".."), "", "C:\\Windows"]) {
      expect(isInside(models, target)).toBe(false);
      expect(() => removeInside(models, target)).toThrow(/refused to delete outside/);
    }
    expect(fs.readFileSync(precious, "utf8")).toBe("{}");
    expect(fs.readFileSync(path.join(sibling, "keep.bin"), "utf8")).toBe("keep");
    expect(fs.existsSync(models)).toBe(true);
    expect(isInside(models, path.join(models, "a"))).toBe(true);
  });
});

describe("speech models (stt.js removeModel)", () => {
  it("deletes one model completely: its folder, its part, a half unpacked archive; the others stay", () => {
    const userData = profile("speech-one");
    const models = path.join(userData, "models");
    const { nemotron, "parakeet-v3": parakeet, "silero-vad": vad } = stt.CATALOGUE;
    install(userData, nemotron);
    install(userData, parakeet);
    install(userData, vad);
    fs.writeFileSync(stt.partFile(userData, nemotron), Buffer.alloc(500));
    fs.mkdirSync(path.join(models, nemotron.archive));
    fs.writeFileSync(path.join(models, nemotron.archive, "half.onnx"), Buffer.alloc(250));
    fs.writeFileSync(path.join(models, `${nemotron.archive}.tar.bz2`), Buffer.alloc(125)); // the name before 0.9.31
    expect(stt.modelsOnDisk(userData).map((m: { key: string }) => m.key)).toEqual(["nemotron", "parakeet-v3"]);
    const freed = stt.removeModel(userData, "nemotron");
    expect(freed).toBe(4 * 1000 + 500 + 250 + 125);
    expect(names(models)).toEqual([parakeet.id, vad.id].sort());
    expect(stt.installedKeys(userData)).toEqual(["parakeet-v3"]);
    // the voice detector goes with the last phrase model that needs it
    expect(stt.removeModel(userData, "parakeet-v3")).toBe(4 * 1000 + 1000);
    expect(names(models)).toEqual([]);
    expect(stt.speechStatus(userData, { language: "en" })).toMatchObject({ model: "missing", usable: false, active: null });
  });

  it("keeps the voice detector while another phrase model needs it, and refuses an unknown key", () => {
    const userData = profile("speech-vad");
    const { dolphin, "parakeet-v3": parakeet, "silero-vad": vad } = stt.CATALOGUE;
    install(userData, dolphin);
    install(userData, parakeet);
    install(userData, vad);
    stt.removeModel(userData, "dolphin");
    expect(names(path.join(userData, "models"))).toEqual([parakeet.id, vad.id].sort());
    expect(() => stt.removeModel(userData, "../../settings")).toThrow(/unknown speech model/);
    expect(() => stt.removeModel(userData, "constructor")).toThrow(/unknown speech model/);
  });

  it("without a key removes every speech model and every part", () => {
    const userData = profile("speech-all");
    for (const spec of Object.values(stt.CATALOGUE) as Array<{ id: string; files: string[] }>) install(userData, spec, 10);
    fs.writeFileSync(stt.partFile(userData, stt.CATALOGUE.dolphin), "part");
    fs.mkdirSync(path.join(userData, "models", "s1-mini"));
    stt.removeModel(userData);
    expect(names(path.join(userData, "models"))).toEqual(["s1-mini"]); // not a speech model: left alone
  });
});

describe("the natural voice (tts.js removeModel)", () => {
  it("deletes the folder and an unfinished download, and reports the bytes", () => {
    const userData = profile("voice");
    install(userData, tts.MODEL, 100);
    fs.writeFileSync(stt.partFile(userData, tts.MODEL), Buffer.alloc(50));
    expect(tts.removeModel(userData)).toBe(7 * 100 + 50);
    expect(names(path.join(userData, "models"))).toEqual([]);
    expect(tts.modelReady(userData)).toBe(false);
  });
});

/** A stand-in for llama-server or the punctuation process: remembers when it was killed. */
function fakeChild(events: string[], name: string) {
  const c = new EventEmitter() as EventEmitter & { kill(): void; postMessage(m: unknown): void; exitCode: number | null };
  c.exitCode = null;
  c.kill = () => { events.push(`${name} killed`); setTimeout(() => { c.exitCode = 0; events.push(`${name} exited`); c.emit("exit", 0); }, 30); };
  c.postMessage = (m: unknown) => { if ((m as { type?: string }).type === "init") setTimeout(() => c.emit("message", { type: "ready" }), 5); };
  return c;
}

describe("S1-mini and the punctuation model (runtime.remove)", () => {
  it("S1-mini: the running llama-server is stopped and gone before the files are deleted", async () => {
    const userData = profile("s1-delete");
    const dir = path.join(userData, "models", "s1-mini");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "s1-mini-q4_k_m.gguf"), Buffer.alloc(2000));
    fs.writeFileSync(path.join(dir, "s1-mini-q4_k_m.gguf.part"), Buffer.alloc(500));
    const events: string[] = [];
    const log: string[] = [];
    const rt = createS1Runtime({
      userData, logLine: (l: string) => log.push(l), serverFile: () => "llama-server", spawn: () => fakeChild(events, "llama-server"),
      fetch: async () => ({ ok: true, json: async () => ({}) }), download: async () => {}, sha256File: async () => "",
    });
    rt.warm();
    for (let i = 0; i < 200 && !rt.status().running; i++) await new Promise((r) => setTimeout(r, 10));
    expect(rt.status()).toMatchObject({ model: true, running: true });
    const realRm = fs.rmSync;
    const freed = await (async () => {
      // the delete must come after the exit, or Windows refuses it
      (fs as { rmSync: typeof fs.rmSync }).rmSync = ((...a: Parameters<typeof fs.rmSync>) => { events.push("files deleted"); return realRm(...a); }) as typeof fs.rmSync;
      try { return await rt.remove(); } finally { (fs as { rmSync: typeof fs.rmSync }).rmSync = realRm; }
    })();
    expect(freed).toBe(2500);
    expect(events).toEqual(["llama-server killed", "llama-server exited", "files deleted"]);
    expect(fs.existsSync(dir)).toBe(false);
    expect(rt.status()).toMatchObject({ model: false, running: false, error: "" });
    // the feature falls back: dictation says why the cleanup step is skipped, nothing throws
    expect(rt.ready()).toEqual({ ok: false, reason: "model not on this computer" });
    expect(log.join("\n")).toMatch(/model deleted by the user \(0 MB freed\)/);
  });

  it("punctuation: the model's process is stopped first, then the folder goes", async () => {
    const userData = profile("truecase-delete");
    const dir = path.join(userData, "models", "truecase-small");
    fs.mkdirSync(dir, { recursive: true });
    for (const f of TRUECASE_FILES as Array<{ name: string }>) fs.writeFileSync(path.join(dir, f.name), Buffer.alloc(100));
    const events: string[] = [];
    const rt = createTruecaseRuntime({ userData, fork: () => fakeChild(events, "worker"), runtimeFile: () => "x", download: async () => {}, sha256File: async () => "" });
    rt.warm();
    for (let i = 0; i < 200 && !rt.status().running; i++) await new Promise((r) => setTimeout(r, 10));
    expect(rt.status().running).toBe(true);
    expect(await rt.remove()).toBe(400);
    expect(events).toEqual(["worker killed", "worker exited"]);
    expect(fs.existsSync(dir)).toBe(false);
    expect(rt.ready()).toEqual({ ok: false, reason: "model not on this computer" });
  });
});

describe("which model is in use (model-use.js)", () => {
  const base = { okFilow: { enabled: true, voice: "natural", voiceUsable: true }, dictation: { enabled: true, language: "auto", cleanup: true, punctuate: true }, cleanup: { installed: true, runtime: true }, punctuation: { installed: true, runtime: true } };
  const hardware = { ramGb: 32, cores: 16 };
  const uses = (list: Array<{ use: string; language: string }> | undefined) => (list || []).map((u) => `${u.use}:${u.language}`);

  it("two speech models installed, one selected: only the selected one is in use, and it says for what", () => {
    const u = modelUse({ ...base, speech: { installed: ["nemotron", "vosk-small-ru"], language: "en", hardware } });
    expect(uses(u.speech.nemotron)).toEqual(["tracking:en", "questions:en", "dictation:en"]);
    expect(u.speech["vosk-small-ru"]).toBeUndefined(); // installed, takes disk space, not in use
  });

  it("follows the same choice the recognizer makes per use and language", () => {
    // Italian: a talk is followed by Nemotron, questions and dictation go to Parakeet (stt.js CANDIDATES)
    const it = modelUse({ ...base, speech: { installed: ["nemotron", "parakeet-v3"], language: "it", hardware } });
    expect(uses(it.speech.nemotron)).toEqual(["tracking:it"]);
    expect(uses(it.speech["parakeet-v3"])).toEqual(["questions:it", "dictation:it"]);
    // dictation in its own language: Japanese dictation while the talk is in English
    const mixed = modelUse({ ...base, dictation: { ...base.dictation, language: "ja" }, speech: { installed: ["nemotron", "parakeet-v3", "reazonspeech-ja"], language: "en", hardware } });
    expect(uses(mixed.speech["reazonspeech-ja"])).toEqual(["dictation:ja"]);
    expect(uses(mixed.speech["parakeet-v3"])).toEqual(["questions:en"]);
    expect(uses(mixed.speech.nemotron)).toEqual(["tracking:en"]);
    // every answer is the recognizer's own pick
    for (const [language, use, purpose] of [["it", "tracking", "tracking"], ["it", "questions", "questions"], ["ro", "tracking", "tracking"]] as const) {
      const installed = ["nemotron", "parakeet-v3"];
      const picked = stt.pickInstalled(stt.chooseModels({ language, use: purpose, ...hardware }), installed).model;
      expect(uses(modelUse({ ...base, speech: { installed, language, hardware } }).speech[picked])).toContain(`${use}:${language}`);
    }
  });

  it("OK Filow or dictation switched off: their uses are gone", () => {
    const u = modelUse({ ...base, okFilow: { enabled: false, voice: "natural", voiceUsable: true }, dictation: { ...base.dictation, enabled: false }, speech: { installed: ["nemotron", "parakeet-v3"], language: "it", hardware } });
    expect(uses(u.speech.nemotron)).toEqual(["tracking:it"]);
    expect(u.speech["parakeet-v3"]).toBeUndefined();
    expect(u.voice).toEqual([]);
    expect(u.cleanup).toEqual([]);
    expect(u.punctuation).toEqual([]);
  });

  it("the voice: in use only when the natural voice is the one that speaks; a cloud or system voice leaves it installed only", () => {
    const speech = { installed: [], language: "en", hardware };
    expect(uses(modelUse({ ...base, speech }).voice)).toEqual(["voice:auto"]);
    for (const voice of ["cloud", "system", "off"]) expect(modelUse({ ...base, speech, okFilow: { enabled: true, voice, voiceUsable: true } }).voice).toEqual([]);
    expect(modelUse({ ...base, speech, okFilow: { enabled: true, voice: "natural", voiceUsable: false } }).voice).toEqual([]);
  });

  it("S1-mini is in use for English dictation with the cleanup switch on; the punctuation model for it, ru, ro, ja", () => {
    const at = (language: string, dictLanguage = "auto", extra = {}) => modelUse({ ...base, dictation: { ...base.dictation, language: dictLanguage, ...extra }, speech: { installed: [], language, hardware } });
    expect(uses(at("en").cleanup)).toEqual(["cleanup:en"]);
    expect(at("en").punctuation).toEqual([]);
    expect(at("it").cleanup).toEqual([]);
    expect(uses(at("it").punctuation)).toEqual(["punctuation:it"]);
    expect(uses(at("en", "ja").punctuation)).toEqual(["punctuation:ja"]);
    expect(at("en", "ja").cleanup).toEqual([]);
    // the language is not known ("auto" everywhere): neither model is picked, as in dictation itself
    expect(at("auto").cleanup).toEqual([]);
    expect(at("auto").punctuation).toEqual([]);
    expect(at("en", "auto", { cleanup: false }).cleanup).toEqual([]);
    expect(at("it", "auto", { punctuate: false }).punctuation).toEqual([]);
    // not on disk, or no runtime in this build: not in use
    expect(modelUse({ ...base, cleanup: { installed: false, runtime: true }, speech: { installed: [], language: "en", hardware } }).cleanup).toEqual([]);
    expect(modelUse({ ...base, punctuation: { installed: true, runtime: false }, speech: { installed: [], language: "it", hardware } }).punctuation).toEqual([]);
  });
});

describe("one list, one stop, one delete (model-control.js)", () => {
  function control(name: string, over: Record<string, unknown> = {}) {
    const userData = profile(name);
    const log: string[] = [];
    const downloads = createDownloads();
    const calls: string[] = [];
    const runtime = (id: string, folder: string) => {
      let downloading = false;
      return {
        start: () => { downloading = true; },
        status: () => ({ runtime: true, model: fs.existsSync(path.join(userData, "models", folder, "model")), running: false, downloading }),
        cancelFetch: () => { const was = downloading; downloading = false; calls.push(`${id} cancelFetch`); return was; },
        remove: async () => { calls.push(`${id} remove`); return removeInside(path.join(userData, "models"), path.join(userData, "models", folder)); },
      };
    };
    const s1 = runtime("cleanup", "s1-mini");
    const tc = runtime("punctuation", "truecase-small");
    let job: { key: string } | null = null;
    const c = createModelControl({
      userData, logLine: (l: string) => log.push(l), downloads, stt, tts,
      speech: {
        language: () => "en", job: () => job, clearJob: () => { job = null; calls.push("job cleared"); }, downloading: () => Promise.resolve(),
        release: async () => { calls.push("recognizers released"); }, loaded: () => ["nemotron"], changed: () => calls.push("status sent"),
      },
      voice: () => null,
      okFilow: () => ({ enabled: true, voice: "natural", offline: false }),
      dictation: () => ({ enabled: true, language: "auto", cleanup: true, punctuate: true }),
      cleanup: () => s1, punctuation: () => tc,
      clearWish: (kind: string) => calls.push(`wish cleared ${kind}`),
      ...over,
    });
    return { userData, log, downloads, calls, c, s1, tc, setJob: (j: { key: string } | null) => { job = j; } };
  }

  it("lists what is on disk with its size, whether it is in use and whether it is loaded", () => {
    const { userData, c } = control("list");
    install(userData, stt.CATALOGUE.nemotron);
    install(userData, stt.CATALOGUE["vosk-small-ru"]);
    fs.mkdirSync(path.join(userData, "models", "s1-mini"));
    fs.writeFileSync(path.join(userData, "models", "s1-mini", "model"), Buffer.alloc(300));
    const s = c.status();
    expect(s.models.map((m: { id: string }) => m.id)).toEqual(["speech:nemotron", "speech:vosk-small-ru", "cleanup"]);
    const [nemotron, vosk, cleanup] = s.models;
    expect(nemotron).toMatchObject({ kind: "speech", installed: true, bytes: 4000, loaded: true });
    expect(nemotron.uses.map((u: { use: string }) => u.use)).toEqual(["tracking", "questions", "dictation"]);
    expect(vosk).toMatchObject({ installed: true, bytes: 4000, uses: [], loaded: false });
    expect(cleanup).toMatchObject({ kind: "cleanup", installed: true, bytes: 300 });
    expect(cleanup.uses).toEqual([{ use: "cleanup", language: "en" }]);
  });

  it("a cloud voice while offline counts as the system voice; the natural voice is not shown in use without the wired voice", () => {
    const { userData, c } = control("list-voice");
    install(userData, tts.MODEL, 10);
    expect(c.status().models[0]).toMatchObject({ id: "voice", installed: true, bytes: 70, uses: [], loaded: false });
    const wired = control("list-voice-wired", { voice: () => ({ usable: () => true, loaded: () => true, remove: async () => ({ freedBytes: 0 }) }) });
    install(wired.userData, tts.MODEL, 10);
    expect(wired.c.status().models[0]).toMatchObject({ id: "voice", uses: [{ use: "voice", language: "auto" }], loaded: true });
    const cloud = control("list-voice-cloud", { voice: () => ({ usable: () => true, loaded: () => false }), okFilow: () => ({ enabled: true, voice: "cloud", offline: false }) });
    install(cloud.userData, tts.MODEL, 10);
    expect(cloud.c.status().models[0].uses).toEqual([]);
  });

  it("stop: by id, for every kind; the wish to resume at the next start is cleared; an unknown id is refused", () => {
    const { c, downloads, calls, s1, log } = control("stop");
    const speech = downloads.begin("speech");
    const voice = downloads.begin("voice");
    downloads.begin("ollama-installer");
    downloads.begin("cloudflared");
    s1.start();
    expect(c.status().downloading.sort()).toEqual(["cleanup", "cloudflared", "ollama-installer", "speech", "voice"]);
    expect(c.cancel("speech")).toEqual({ ok: true, stopped: true });
    expect(speech.aborted).toBe(true);
    expect(voice.aborted).toBe(false);
    expect(c.cancel("voice")).toEqual({ ok: true, stopped: true });
    expect(c.cancel("ollama-installer")).toEqual({ ok: true, stopped: true });
    expect(c.cancel("cloudflared")).toEqual({ ok: true, stopped: true });
    expect(c.cancel("cleanup")).toEqual({ ok: true, stopped: true });
    expect(c.cancel("punctuation")).toEqual({ ok: true, stopped: false });
    expect(calls).toEqual(["cleanup cancelFetch", "wish cleared cleanup", "punctuation cancelFetch", "wish cleared punctuation"]);
    expect(c.cancel("speech")).toEqual({ ok: true, stopped: false });
    expect(c.cancel("../../x")).toMatchObject({ ok: false });
    expect(c.status().downloading).toEqual([]);
    // a stop is logged as the user's choice, never as a failure
    expect(log.filter((l) => /stopped by the user/.test(l)).length).toBe(5);
    expect(log.join("\n")).not.toMatch(/fail|error/i);
  });

  it("delete a speech model: the recognizers let go first, a download of that model is stopped, the rest stays", async () => {
    const { userData, c, calls, downloads, setJob } = control("delete-speech");
    install(userData, stt.CATALOGUE.nemotron);
    install(userData, stt.CATALOGUE["vosk-small-ru"]);
    const signal = downloads.begin("speech");
    setJob({ key: "vosk-small-ru" });
    expect(await c.remove("speech:nemotron")).toEqual({ ok: true, freedBytes: 4000 });
    expect(signal.aborted).toBe(false); // another model's download is not touched
    expect(calls).toEqual(["recognizers released", "status sent"]);
    expect(names(path.join(userData, "models"))).toEqual([stt.CATALOGUE["vosk-small-ru"].id]);
    expect(await c.remove("speech:vosk-small-ru")).toEqual({ ok: true, freedBytes: 4000 });
    expect(signal.aborted).toBe(true);
    expect(calls).toContain("job cleared");
    expect(c.status().models).toEqual([]);
  });

  it("delete S1-mini and the punctuation model: wish cleared, runtime asked to remove; unknown ids delete nothing", async () => {
    const { userData, c, calls } = control("delete-others");
    for (const folder of ["s1-mini", "truecase-small"]) {
      fs.mkdirSync(path.join(userData, "models", folder));
      fs.writeFileSync(path.join(userData, "models", folder, "model"), Buffer.alloc(100));
    }
    fs.writeFileSync(path.join(userData, "settings.json"), "{}");
    expect(await c.remove("cleanup")).toEqual({ ok: true, freedBytes: 100 });
    expect(await c.remove("punctuation")).toEqual({ ok: true, freedBytes: 100 });
    expect(calls).toEqual(["wish cleared cleanup", "cleanup remove", "wish cleared punctuation", "punctuation remove"]);
    for (const id of ["speech:../../settings.json", "speech:", "settings.json", "..", ""]) expect(await c.remove(id)).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(userData, "settings.json"))).toBe(true);
    expect(names(path.join(userData, "models"))).toEqual([]);
  });

  it("delete the voice without OK Filow running still removes the files", async () => {
    const { userData, c } = control("delete-voice");
    install(userData, tts.MODEL, 10);
    expect(await c.remove("voice")).toEqual({ ok: true, freedBytes: 70 });
    expect(names(path.join(userData, "models"))).toEqual([]);
  });
});
