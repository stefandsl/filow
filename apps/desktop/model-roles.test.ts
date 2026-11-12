import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { chooseModels, pickInstalled, SttSession, CATALOGUE, modelDir, speechStatus } = require("./stt.js");
const { speechPins, speechPin } = require("./model-roles.js");
const { modelUse } = require("./model-use.js");

const root = tmpRoot("model-roles");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A profile folder with a model-roles.json and the given speech models "on disk" (their files, empty). */
function profile(name: string, pins: unknown, onDisk: string[] = []) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (pins !== undefined) fs.writeFileSync(path.join(dir, "model-roles.json"), JSON.stringify({ version: 1, servers: [], pins }));
  for (const key of [...onDisk, "silero-vad"]) {
    const spec = CATALOGUE[key];
    fs.mkdirSync(modelDir(dir, spec), { recursive: true });
    for (const f of spec.files) fs.writeFileSync(path.join(modelDir(dir, spec), f), "");
  }
  return dir;
}

const pc = { ramGb: 32, cores: 16 };

describe("the speech model the user chose for a task", () => {
  it("is used when it can listen in this language and is on disk", () => {
    const choice = chooseModels({ language: "it", use: "tracking", ...pc });
    expect(pickInstalled(choice, ["nemotron", "parakeet-v3"]).model).toBe("nemotron");
    expect(pickInstalled(choice, ["nemotron", "parakeet-v3"], "parakeet-v3")).toMatchObject({ model: "parakeet-v3", pinned: true, notes: ["phrases"] });
  });
  it("deleted: the automatic pick, with a note that says so", () => {
    const choice = chooseModels({ language: "it", use: "tracking", ...pc });
    expect(pickInstalled(choice, ["nemotron"], "parakeet-v3")).toMatchObject({ model: "nemotron", pinned: false, notes: ["pinMissing"] });
  });
  it("a model that cannot listen in this language is never used for it", () => {
    const choice = chooseModels({ language: "it", use: "questions", ...pc });
    expect(pickInstalled(choice, ["nemotron", "reazonspeech-ja"], "reazonspeech-ja")).toMatchObject({ model: "nemotron", pinned: false, notes: ["fallback", "pinUnfit"] });
  });
  it("is read from the profile's model-roles.json: speech on this PC only, a bad entry ignored", () => {
    const dir = profile("read", { tracking: { source: "local", model: "parakeet-v3" }, questions: { source: "rig1", model: "nemotron" }, dictation: { source: "local", model: "../evil" }, translate: { source: "local", model: "gemma4:e4b" } });
    expect(speechPins(dir)).toEqual({ tracking: "parakeet-v3" });
    expect(speechPin(dir, "questions")).toBeNull();
    expect(speechPins(path.join(root, "nothing-here"))).toEqual({});
  });
  it("the talk follows its own choice and OK Filow's questions and dictation theirs, in the same session", () => {
    const dir = profile("session", { tracking: { source: "local", model: "parakeet-v3" }, dictation: { source: "local", model: "parakeet-v3" } }, ["nemotron", "parakeet-v3"]);
    const talk = new SttSession(dir, null, { use: "tracking", getLanguage: () => "it", task: () => "tracking", hardware: pc });
    expect(talk.plan().pick.model).toBe("parakeet-v3");
    let purpose = "talk";
    const okf = new SttSession(dir, null, { getLanguage: () => "it", task: () => (purpose === "dictate" ? "dictation" : "questions"), hardware: pc });
    expect(okf.plan().pick.model).toBe("nemotron");
    purpose = "dictate";
    expect(okf.plan().pick.model).toBe("parakeet-v3");
    // a session that says nothing about its task keeps the automatic pick
    expect(new SttSession(dir, null, { getLanguage: () => "it", hardware: pc }).plan().pick.model).toBe("nemotron");
  });
  it("the speech status the prompter and Settings read names the chosen model as the one that listens", () => {
    const dir = profile("status", { tracking: { source: "local", model: "parakeet-v3" } }, ["nemotron", "parakeet-v3"]);
    const s = speechStatus(dir, { language: "it", hardware: pc });
    expect(s).toMatchObject({ active: "parakeet-v3", activeLabel: "Parakeet TDT 0.6b v3" });
    // without the choice, the talk is followed with the streaming model
    expect(speechStatus(profile("status-auto", {}, ["nemotron", "parakeet-v3"]), { language: "it", hardware: pc }).active).toBe("nemotron");
    expect(s.notes).not.toContain("fallback");
  });
});

describe("the in-use badge and the per-task rows follow the choice", () => {
  const input = (pins: Record<string, string>) => ({
    speech: { installed: ["nemotron", "parakeet-v3"], language: "it", hardware: pc, pins },
    okFilow: { enabled: true, voice: "off" },
    dictation: { enabled: true, language: "auto" },
  });
  it("nothing chosen: automatic everywhere", () => {
    const u = modelUse(input({}));
    expect(u.speech.nemotron.map((x: { use: string }) => x.use)).toEqual(["tracking"]);
    expect(u.speech["parakeet-v3"].map((x: { use: string }) => x.use)).toEqual(["questions", "dictation"]);
    expect(u.speechRoles.tracking).toMatchObject({ auto: "nemotron", active: "nemotron", pin: null, note: null });
  });
  it("a chosen model is the one marked in use for that task", () => {
    const u = modelUse(input({ dictation: "nemotron", tracking: "parakeet-v3" }));
    expect(u.speech["parakeet-v3"].map((x: { use: string }) => x.use)).toEqual(["tracking", "questions"]);
    expect(u.speech.nemotron.map((x: { use: string }) => x.use)).toEqual(["dictation"]);
    expect(u.speechRoles.tracking).toMatchObject({ auto: "nemotron", active: "parakeet-v3", pin: "parakeet-v3", note: null });
  });
  it("a choice that cannot be used is reported, and the automatic pick listens", () => {
    const u = modelUse(input({ tracking: "reazonspeech-ja" }));
    expect(u.speechRoles.tracking).toMatchObject({ active: "nemotron", pin: "reazonspeech-ja", note: "pinUnfit" });
    expect(u.speechRoles.tracking.can).not.toContain("reazonspeech-ja");
  });
});
