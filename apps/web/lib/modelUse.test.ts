// "Installed" is not "in use" (owner, 2026-11-11: "i wish you had not only that but what actually is in
// use"). The settings page works out the badge here, from the plan a take starts with, the user's
// switches and the Ollama models the server's own pickers name. A feature set to the cloud uses no
// local model.
import { describe, expect, it, vi, afterEach } from "vitest";
import { t as translate, LANGS, type I18nKey } from "@filow/core";
import { browserUses, deleteQuestion, deviceUses, ollamaUses, sizeText, usesText, type DeviceModel, type UseContext } from "./modelUse";
import { GET as localStatus } from "@/app/api/local/status/route";
import { DELETE as deleteModel } from "@/app/api/local/pull/route";
import * as sysinfo from "@/lib/sysinfo";

const t = (key: I18nKey, vars?: Record<string, string | number>) => translate(key, "en", vars);
const local: UseContext = {
  plan: { stt: { backend: "sherpa" }, decision: { provider: "clef-local" }, generate: { provider: "ollama", model: "gemma4:e4b" } },
  startMode: "auto", decisionPref: "", okFilow: { enabled: true, provider: "local", offline: false }, translateWhere: "local", gateMode: "on",
  whisperModel: "onnx-community/whisper-base", picks: { decision: "clef-flash", translate: "gemma4:e4b", okfilow: ["lfm3-vl", "qwen3-vl:2b"] },
};
const names = (uses: Array<{ use: string }>) => uses.map((u) => u.use);
const speech = (uses: DeviceModel["uses"]): Pick<DeviceModel, "uses"> => ({ uses });

describe("speech models from the desktop app's list", () => {
  const all = speech([{ use: "tracking", language: "it" }, { use: "questions", language: "it" }, { use: "dictation", language: "it" }]);

  it("following a talk counts only when a take would really use the on-device recognizer", () => {
    expect(names(deviceUses(all, local))).toEqual(["tracking", "questions", "dictation"]);
    // the plan picked Whisper in the app, a cloud engine, or nothing
    for (const backend of ["whisper", "elevenlabs", "openai", "browser", null]) {
      expect(names(deviceUses(all, { ...local, plan: { ...local.plan!, stt: { backend } } }))).toEqual(["questions", "dictation"]);
    }
    expect(names(deviceUses(all, { ...local, plan: null }))).toEqual(["questions", "dictation"]);
  });

  it("takes set to the cloud: the model is still in use for questions and dictation, not for the talk", () => {
    expect(names(deviceUses(all, { ...local, startMode: "cloud" }))).toEqual(["questions", "dictation"]);
    expect(deviceUses(speech([{ use: "tracking", language: "en" }]), { ...local, startMode: "cloud" })).toEqual([]);
  });

  it("a model nothing picked stays without uses", () => {
    expect(deviceUses(speech([]), local)).toEqual([]);
  });
});

describe("Ollama models", () => {
  it("two installed, one selected: only the one each feature would call is in use, and it says for what", () => {
    expect(names(ollamaUses("gemma4:e4b", local))).toEqual(["generate", "translate"]);
    expect(ollamaUses("gemma4:e2b", local)).toEqual([]); // installed next to it, only taking disk space
    expect(names(ollamaUses("clef-flash", local))).toEqual(["decision"]);
    expect(ollamaUses("clef", local)).toEqual([]);
    expect(names(ollamaUses("lfm3-vl", local))).toEqual(["okfilow"]);
    expect(names(ollamaUses("qwen3-vl:2b", local))).toEqual(["okfilow"]);
    // another tag of the same family is another model
    expect(ollamaUses("qwen3-vl", local)).toEqual([]);
    expect(names(ollamaUses("clef-flash", { ...local, picks: { ...local.picks!, decision: "clef-flash:latest" } }))).toEqual(["decision"]);
  });

  it("a cloud choice counts: no local model is in use for that feature", () => {
    expect(ollamaUses("clef-flash", { ...local, plan: { ...local.plan!, decision: { provider: "openrouter" } } })).toEqual([]);
    expect(ollamaUses("clef-flash", { ...local, decisionPref: "openrouter" })).toEqual([]);
    expect(ollamaUses("clef-flash", { ...local, startMode: "cloud" })).toEqual([]);
    expect(names(ollamaUses("gemma4:e4b", { ...local, translateWhere: "cloud" }))).toEqual(["generate"]);
    expect(names(ollamaUses("gemma4:e4b", { ...local, plan: { ...local.plan!, generate: { provider: "openrouter", model: null } } }))).toEqual(["translate"]);
    expect(ollamaUses("lfm3-vl", { ...local, okFilow: { enabled: true, provider: "cloud", offline: false } })).toEqual([]);
    expect(ollamaUses("lfm3-vl", { ...local, okFilow: { enabled: false, provider: "local", offline: false } })).toEqual([]);
    expect(ollamaUses("lfm3-vl", { ...local, okFilow: null })).toEqual([]);
  });

  it("a pinned local provider is in use even when the plan would pick the matcher", () => {
    expect(names(ollamaUses("clef-flash", { ...local, decisionPref: "clef-local", plan: { ...local.plan!, decision: { provider: "matcher" } } }))).toEqual(["decision"]);
    expect(ollamaUses("clef-flash", { ...local, plan: { ...local.plan!, decision: { provider: "matcher" } } })).toEqual([]);
  });

  it("nothing is known yet (no plan, no picks): nothing is claimed", () => {
    expect(ollamaUses("gemma4:e4b", { ...local, plan: null, picks: null })).toEqual([]);
  });
});

describe("models inside the app's own page", () => {
  it("the Whisper model picked is in use only when the plan follows the talk with Whisper", () => {
    const whisper = { ...local, plan: { ...local.plan!, stt: { backend: "whisper" } } };
    expect(names(browserUses({ name: "onnx-community/whisper-base", kind: "whisper" }, whisper))).toEqual(["tracking"]);
    expect(browserUses({ name: "onnx-community/whisper-small", kind: "whisper" }, whisper)).toEqual([]);
    expect(browserUses({ name: "onnx-community/whisper-base", kind: "whisper" }, local)).toEqual([]);
    expect(browserUses({ name: "onnx-community/whisper-base", kind: "whisper" }, { ...whisper, startMode: "cloud" })).toEqual([]);
  });

  it("the pre-filter model follows its switch", () => {
    expect(names(browserUses({ name: "x", kind: "gate" }, local))).toEqual(["gate"]);
    expect(browserUses({ name: "x", kind: "gate" }, { ...local, gateMode: "off" })).toEqual([]);
  });
});

describe("the words", () => {
  it("names each use, with the language where one is set", () => {
    expect(usesText([{ use: "tracking", language: "auto" }, { use: "dictation", language: "it" }], t)).toBe("following a talk, dictation (Italiano)");
    expect(usesText([{ use: "cleanup", language: "en" }], t)).toBe("English dictation cleanup");
    expect(usesText([{ use: "translate" }, { use: "generate" }], t)).toBe("translation, script from slides");
  });

  it("sizes read as a person writes them", () => {
    expect(sizeText(475271763, t)).toBe("453 MB");
    expect(sizeText(6.1 * 1024 ** 3, t)).toBe("6.1 GB");
    expect(sizeText(100, t)).toBe("1 MB");
    expect(sizeText(713097333, (k, v) => translate(k, "ru", v))).toBe("680 МБ");
  });

  it("the delete question names the model and its size; in use, it says for what and what happens next", () => {
    const idle = deleteQuestion({ name: "Vosk small Russian streaming", size: "23 MB", uses: [], effect: "speech" }, t);
    expect(idle).toBe("Delete Vosk small Russian streaming (23 MB) from this computer?");
    const used = deleteQuestion({ name: "Nemotron 3.5 streaming", size: "453 MB", uses: [{ use: "tracking", language: "en" }, { use: "dictation", language: "en" }], effect: "speech" }, t);
    expect(used).toBe("Delete Nemotron 3.5 streaming (453 MB) from this computer?\n\nIt is in use: following a talk (English), dictation (English). Filow will use another installed speech model if one fits, or tell you that none is installed.");
  });

  it("every language has the words, with no em dash and every placeholder kept", () => {
    const keys = ["settings.stop", "settings.stopLabel", "settings.stopHint", "settings.stopHintOllama", "settings.inUse", "settings.loaded", "settings.partial", "settings.deleteModelConfirm", "settings.deleteModelInUse", "settings.deleteLabel", "settings.freed", "settings.deleteFailed", "settings.onThisPc", "settings.onThisPcHint", "settings.onThisPcNone", "size.mb", "size.gb", "use.withLanguage",
      ...["speech", "voice", "cleanup", "punctuation"].map((k) => `modelKind.${k}`),
      ...["tracking", "questions", "dictation", "voice", "cleanup", "punctuation", "decision", "generate", "translate", "okfilow", "gate"].map((k) => `use.${k}`),
      ...["speech", "voice", "cleanup", "punctuation", "ollama", "browser"].map((k) => `deleteEffect.${k}`)] as I18nKey[];
    for (const lang of LANGS) {
      for (const key of keys) {
        const text = translate(key, lang);
        expect(text, `${lang} ${key}`).not.toBe(key);
        expect(text, `${lang} ${key}`).not.toContain("—");
        expect((text.match(/\{\w+\}/g) ?? []).sort(), `${lang} ${key}`).toEqual((translate(key, "en").match(/\{\w+\}/g) ?? []).sort());
        if (lang !== "en" && !["size.mb", "size.gb", "use.withLanguage"].includes(key)) expect(text, `${lang} ${key} is still English`).not.toBe(translate(key, "en"));
      }
      // "in use" must not read like "installed": the badge differs by its words, not by colour alone
      expect(translate("settings.inUse", lang, { what: "" }).trim()).not.toBe(translate("settings.installed", lang));
    }
  });
});

describe("the server names the models from the features' own pickers", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const ollama = (tags: string[]) => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (String(url).endsWith("/api/version")) return Response.json({ version: "0.40.16" });
      if (String(url).endsWith("/api/tags")) return Response.json({ models: tags.map((name) => ({ name, size: 5 * 1024 ** 3 })) });
      return Response.json({});
    }));
    return calls;
  };
  const env = () => {
    for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "1", OLLAMA_URL: "http://127.0.0.1:59999", CLEF_MODEL: "", TRANSLATE_LOCAL_MODEL: "", BUDDY_LOCAL_MODEL: "" })) vi.stubEnv(k, v);
    vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
  };

  it("status carries picks: Clef for decisions, the best installed Gemma for translation, the setup's helper for OK Filow", async () => {
    env();
    ollama(["gemma4:e2b", "gemma4:e4b", "clef-flash:latest"]);
    const s = (await (await localStatus(new Request("http://unit.invalid/api/local/status?setup=lite"))).json()) as { picks: UseContext["picks"] };
    expect(s.picks).toMatchObject({ decision: "clef-flash", translate: "gemma4:e4b" });
    expect(Array.isArray(s.picks!.okfilow)).toBe(true);
    // two installed, one selected, end to end
    const ctx = { ...local, picks: s.picks, plan: { ...local.plan!, generate: { provider: "none", model: null } } };
    expect(names(ollamaUses("gemma4:e4b", ctx))).toEqual(["translate"]);
    expect(ollamaUses("gemma4:e2b", ctx)).toEqual([]);
  });

  it("only e2b installed: translation picks it", async () => {
    env();
    ollama(["gemma4:e2b"]);
    const s = (await (await localStatus(new Request("http://unit.invalid/api/local/status"))).json()) as { picks: UseContext["picks"] };
    expect(s.picks!.translate).toBe("gemma4:e2b");
  });

  it("delete goes to Ollama only for a model Filow offers", async () => {
    env();
    const calls = ollama([]);
    const del = (name: string) => deleteModel(new Request("http://unit.invalid/api/local/pull", { method: "DELETE", body: JSON.stringify({ name }) }));
    expect((await del("llama3:latest")).status).toBe(400);
    expect((await del("../../etc")).status).toBe(400);
    expect((await del("")).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await del("gemma4:e2b")).status).toBe(200);
    expect((await del("clef-flash:latest")).status).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.url} ${c.body}`)).toEqual([
      'DELETE http://127.0.0.1:59999/api/delete {"model":"gemma4:e2b"}',
      'DELETE http://127.0.0.1:59999/api/delete {"model":"clef-flash:latest"}',
    ]);
  });
});
