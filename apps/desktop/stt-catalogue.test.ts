import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const stt = require("./stt.js");
const { CATALOGUE, LANGUAGES, normaliseLanguage, tierFor, chooseModels, pickInstalled, requiredSpecs, recognizerConfig, speechStatus, installedKeys, modelDir } = stt;

// Fake model folders live in the project's own tmp folder (never on C:).
const root = path.resolve(__dirname, "../../tmp/test-stt-catalogue");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A userData folder where the given catalogue entries look unpacked. */
function userDataWith(name: string, keys: string[]): string {
  const dir = path.join(root, name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const key of keys) {
    const spec = CATALOGUE[key];
    fs.mkdirSync(modelDir(dir, spec), { recursive: true });
    for (const f of spec.files) fs.writeFileSync(path.join(modelDir(dir, spec), f), "x");
  }
  return dir;
}

const strong = { ramGb: 16, cores: 8 };
const weak = { ramGb: 4, cores: 4 };

describe("speech model catalogue", () => {
  it("pins every entry to the sherpa-onnx release page with a SHA-256 and a size", () => {
    for (const spec of Object.values(CATALOGUE) as any[]) {
      expect(spec.url, spec.key).toMatch(/^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/asr-models\//);
      expect(spec.sha256, spec.key).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.sizeBytes, spec.key).toBeGreaterThan(0);
      expect(spec.licence, spec.key).toBeTruthy();
    }
  });

  it("offers, for every language, use and machine, models that exist and speak that language", () => {
    for (const use of ["tracking", "questions"])
      for (const hw of [strong, weak])
        for (const language of ["auto", ...LANGUAGES]) {
          const { models } = chooseModels({ language, use, ...hw });
          expect(models.length, `${use} ${language}`).toBeGreaterThan(0);
          for (const key of models) {
            expect(CATALOGUE[key], key).toBeDefined();
            if (language !== "auto") expect(CATALOGUE[key].languages, `${key} for ${language}`).toContain(language);
          }
        }
  });

  it("reads language tags and falls back to auto for languages it has no choice for", () => {
    expect(normaliseLanguage("ja-JP")).toBe("ja");
    expect(normaliseLanguage(" RU ")).toBe("ru");
    expect(normaliseLanguage("de")).toBe("auto");
    expect(normaliseLanguage(undefined)).toBe("auto");
  });

  it("calls a PC with under 6 GB or at most 4 logical processors light, and unknown hardware standard", () => {
    expect(tierFor({ ramGb: 4, cores: 16 })).toBe("light");
    expect(tierFor({ ramGb: 32, cores: 4 })).toBe("light");
    expect(tierFor({ ramGb: 8, cores: 8 })).toBe("standard");
    expect(tierFor({})).toBe("standard");
  });

  it("gives a light PC the lighter model where one exists", () => {
    expect(chooseModels({ language: "ru", ...strong }).models[0]).toBe("nemotron");
    expect(chooseModels({ language: "ru", ...weak }).models[0]).toBe("vosk-small-ru");
    expect(chooseModels({ language: "ja", ...weak }).models[0]).toBe("dolphin");
    expect(CATALOGUE["vosk-small-ru"].sizeBytes).toBeLessThan(CATALOGUE.nemotron.sizeBytes / 10);
  });

  it("follows Romanian phrase by phrase: no streaming model is good enough for it", () => {
    const choice = chooseModels({ language: "ro", ...strong });
    expect(CATALOGUE[choice.models[0]].kind).toBe("offline");
    expect(pickInstalled(choice, ["parakeet-v3", "nemotron"])).toMatchObject({ model: "parakeet-v3", streaming: false, notes: ["phrases"] });
  });

  it("uses a downloaded fallback and says so, and nothing when no model for the language is on disk", () => {
    const ja = chooseModels({ language: "ja", ...strong });
    expect(pickInstalled(ja, ["reazonspeech-ja"])).toMatchObject({ model: "reazonspeech-ja", wanted: "nemotron", notes: ["fallback", "phrases"] });
    expect(pickInstalled(chooseModels({ language: "ro", ...strong }), ["vosk-small-ru"]).model).toBeNull();
    expect(pickInstalled(chooseModels({ language: "en", ...strong }), ["nemotron"]).notes).toEqual([]);
  });

  it("downloads the voice detector with every phrase model", () => {
    expect(requiredSpecs("parakeet-v3").map((s: any) => s.key)).toEqual(["silero-vad", "parakeet-v3"]);
    expect(requiredSpecs("nemotron").map((s: any) => s.key)).toEqual(["nemotron"]);
    expect(requiredSpecs("nope")).toEqual([]);
  });

  it("does not count a phrase model as usable without the voice detector", () => {
    expect(installedKeys(userDataWith("no-vad", ["parakeet-v3"]))).toEqual([]);
    expect(installedKeys(userDataWith("with-vad", ["parakeet-v3", "silero-vad"]))).toEqual(["parakeet-v3"]);
  });

  it("builds the recognizer configuration each model family needs", () => {
    const dir = "M";
    const nemo = recognizerConfig(CATALOGUE["parakeet-v3"], dir, 2);
    expect(nemo.modelConfig.modelType).toBe("nemo_transducer");
    expect(nemo.enableEndpoint).toBeUndefined();
    const dolphin = recognizerConfig(CATALOGUE.dolphin, dir, 2);
    expect(dolphin.modelConfig.dolphin.model).toBe(path.join(dir, "model.int8.onnx"));
    expect(dolphin.modelConfig.transducer).toBeUndefined();
    const online = recognizerConfig(CATALOGUE["vosk-small-ru"], dir, 3);
    expect(online.modelConfig).toMatchObject({ numThreads: 3, tokens: path.join(dir, "tokens.txt") });
    expect(online.modelConfig.transducer.decoder).toBe(path.join(dir, "decoder.onnx"));
    expect(online.enableEndpoint).toBe(1);
  });

  it("tells the settings page what a Romanian speaker gives up, and what to download", () => {
    const s = speechStatus(userDataWith("ro-none", []), { language: "ro", hardware: strong });
    expect(s).toMatchObject({ language: "ro", model: "missing", wanted: "parakeet-v3", wantedStreaming: false, usable: false });
    expect(speechStatus(userDataWith("en-none", []), { language: "en", hardware: strong }).wantedStreaming).toBe(true);
    expect(s.downloadBytes).toBe(CATALOGUE["parakeet-v3"].sizeBytes + CATALOGUE["silero-vad"].sizeBytes);
    const ready = speechStatus(userDataWith("ro-ready", ["parakeet-v3", "silero-vad"]), { language: "ro", hardware: strong });
    expect(ready).toMatchObject({ model: "ready", usable: true, streaming: false, notes: ["phrases"] });
  });

  it("reports a download in flight only for the model this language wants", () => {
    const dir = userDataWith("job", []);
    const job = { key: "nemotron", state: "downloading", pct: 40 };
    expect(speechStatus(dir, { language: "en", hardware: strong, job })).toMatchObject({ model: "downloading", pct: 40 });
    expect(speechStatus(dir, { language: "ro", hardware: strong, job })).toMatchObject({ model: "missing", pct: 0 });
  });
});

describe("speech worker, phrase models", () => {
  /** Runs the real worker against a fake sherpa-onnx whose voice detector closes one phrase per 1024 samples. */
  function worker() {
    const posted: any[] = [];
    let receive!: (m: unknown) => void;
    const fed: number[] = [];
    let queue: Float32Array[] = [];
    let buffered = 0;
    const fake = {
      OfflineRecognizer: function () {
        return { createStream: () => ({ acceptWaveform({ samples }: { samples: Float32Array }) { (this as any).n = samples.length; } }), decode() {}, getResult: (s: any) => ({ text: ` phrase of ${s.n} ` }) };
      },
      Vad: function (config: any) {
        expect(config.sileroVad.windowSize).toBe(512);
        return {
          acceptWaveform(w: Float32Array) { fed.push(w.length); buffered += w.length; if (buffered >= 1024) { queue.push(new Float32Array(buffered)); buffered = 0; } },
          isEmpty: () => queue.length === 0, pop: () => { queue = queue.slice(1); },
          // Like Electron: a segment that points into native memory is refused.
          front: (external = true) => { if (external) throw new Error("External buffers are not allowed"); return { samples: queue[0] }; },
          flush() { if (buffered) queue.push(new Float32Array(buffered)); buffered = 0; }, reset() {},
        };
      },
    };
    runInNewContext(readFileSync(path.join(__dirname, "stt-worker.js"), "utf8"), {
      require: (id: string) => (id === "node:worker_threads" ? { parentPort: { on: (_e: string, fn: typeof receive) => { receive = fn; }, postMessage: (m: any) => posted.push(m) } } : fake),
      Float32Array, Date,
    });
    return { posted, fed, send: (m: unknown) => receive(m) };
  }

  it("feeds the voice detector whole 512-sample windows and commits each closed phrase once", () => {
    const w = worker();
    w.send({ type: "init", kind: "offline", config: {}, vad: "vad.onnx" });
    expect(w.posted[0].type).toBe("ready");
    w.send({ type: "feed", samples: new Float32Array(700) });
    w.send({ type: "feed", samples: new Float32Array(700) });
    expect(w.fed).toEqual([512, 512]);
    expect(w.posted.slice(1)).toEqual([{ type: "result", partial: "", committed: "phrase of 1024" }]);
  });

  it("sends the unfinished phrase on stop, its last part window padded with silence, then acknowledges", () => {
    const w = worker();
    w.send({ type: "init", kind: "offline", config: {}, vad: "vad.onnx" });
    w.send({ type: "feed", samples: new Float32Array(600) });
    w.send({ type: "stop" });
    expect(w.fed).toEqual([512, 512]);
    expect(w.posted.slice(1)).toEqual([{ type: "result", partial: "", committed: "phrase of 1024" }, { type: "stopped" }]);
  });
});
