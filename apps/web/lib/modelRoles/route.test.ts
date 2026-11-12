import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/local/roles/route";
import { forgetLists } from "./resolve";
import { readRoles } from "./store";
import { missingPin, ollamaGroups, selectedValue, speechGroup, type RolesData } from "./view";

const DIR = path.join(process.cwd(), "tmp", `model-roles-route-${process.pid}`);
const FILE = path.join(DIR, "model-roles.json");
const HERE = "http://127.0.0.1:11434";
const RIG = "http://192.168.1.20:11434";

function fakeOllamas(hosts: Record<string, Array<{ name: string; caps: string[] }> | null>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const host = Object.keys(hosts).find((h) => url.startsWith(h));
    const models = host ? hosts[host] : null;
    if (!models) throw new TypeError("fetch failed");
    if (url.endsWith("/api/tags")) return Response.json({ models: models.map((m) => ({ name: m.name, size: 1, digest: m.name })) });
    if (url.endsWith("/api/show")) return Response.json({ capabilities: models.find((m) => m.name === JSON.parse(String(init?.body)).model)?.caps ?? [] });
    return new Response("{}", { status: 404 });
  }));
  return calls;
}

const put = (body: unknown) => PUT(new Request("http://unit.invalid/api/local/roles", { method: "PUT", body: JSON.stringify(body) }));
const get = async () => (await GET(new Request("http://unit.invalid/api/local/roles"))).json();

describe("PUT /api/local/roles", () => {
  beforeEach(() => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.rmSync(FILE, { force: true });
    forgetLists();
    for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_MODEL_ROLES: FILE, OLLAMA_URL: HERE, BUDDY_LOCAL_MODEL: "" })) vi.stubEnv(k, v);
    fakeOllamas({
      [HERE]: [{ name: "qwen3-vl:2b", caps: ["completion", "vision"] }, { name: "llama3.2:3b", caps: ["completion"] }],
      [RIG]: [{ name: "qwen3-vl:8b", caps: ["completion", "vision"] }],
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(() => {
    if (DIR.includes(`model-roles-route-${process.pid}`)) fs.rmSync(DIR, { recursive: true, force: true });
  });

  it("adds a server; a bad, repeated or this-PC address is refused", async () => {
    expect((await put({ action: "addServer", name: "Rig", url: "192.168.1.20:11434" })).status).toBe(200);
    expect(readRoles(FILE).servers).toEqual([{ id: expect.any(String), name: "Rig", url: RIG }]);
    expect(await (await put({ action: "addServer", url: "http://192.168.1.20:11434/" })).json()).toMatchObject({ code: "duplicate" });
    expect(await (await put({ action: "addServer", url: HERE })).json()).toMatchObject({ code: "duplicate" });
    expect(await (await put({ action: "addServer", url: "ftp://x" })).json()).toMatchObject({ code: "url_scheme" });
    expect(await (await put({ action: "addServer", url: " " })).json()).toMatchObject({ code: "url_empty" });
  });
  it("a task goes to a server only with the yes, and only to a model that can do it", async () => {
    await put({ action: "addServer", name: "Rig", url: RIG });
    const id = readRoles(FILE).servers[0].id;
    expect(await (await put({ action: "pin", task: "okfilowPointing", pin: { source: id, model: "qwen3-vl:8b" } })).json()).toMatchObject({ code: "agree_first" });
    expect(readRoles(FILE).pins).toEqual({});
    expect(await (await put({ action: "pin", task: "okfilowPointing", pin: { source: "local", model: "llama3.2:3b" } })).json()).toMatchObject({ code: "unfit_vision" });
    expect(await (await put({ action: "pin", task: "decision", pin: { source: "local", model: "qwen3-vl:2b" } })).json()).toMatchObject({ code: "unfit_clef" });
    expect(await (await put({ action: "pin", task: "translate", pin: { source: "local", model: "gone:1b" } })).json()).toMatchObject({ code: "missing" });
    expect((await put({ action: "pin", task: "okfilowPointing", pin: { source: id, model: "qwen3-vl:8b", agreed: true } })).status).toBe(200);
    expect(readRoles(FILE).pins.okfilowPointing).toEqual({ source: id, model: "qwen3-vl:8b", agreed: true });
    // back to Automatic
    await put({ action: "pin", task: "okfilowPointing", pin: null });
    expect(readRoles(FILE).pins).toEqual({});
  });
  it("speech is chosen on this PC only; one-model tasks are not pinnable", async () => {
    expect((await put({ action: "pin", task: "dictation", pin: { source: "local", model: "parakeet-v3" } })).status).toBe(200);
    expect(await (await put({ action: "pin", task: "dictation", pin: { source: "rig", model: "parakeet-v3" } })).json()).toMatchObject({ code: "bad_pin" });
    expect(await (await put({ action: "pin", task: "voice", pin: { source: "local", model: "x" } })).json()).toMatchObject({ code: "not_pinnable" });
  });
  it("removing a server puts its tasks back on Automatic", async () => {
    await put({ action: "addServer", name: "Rig", url: RIG });
    const id = readRoles(FILE).servers[0].id;
    await put({ action: "pin", task: "translate", pin: { source: id, model: "qwen3-vl:8b", agreed: true } });
    await put({ action: "removeServer", id });
    expect(readRoles(FILE)).toEqual({ version: 1, servers: [], pins: {} });
  });
  it("translation runs where the user chose, and says which of his computers", async () => {
    const { localTranslateState } = await import("@/lib/translateLocal");
    expect(await localTranslateState()).toEqual({ ok: false, reason: "no_model" });
    await put({ action: "addServer", name: "Rig", url: RIG });
    const id = readRoles(FILE).servers[0].id;
    await put({ action: "pin", task: "translate", pin: { source: id, model: "qwen3-vl:8b", agreed: true } });
    expect(await localTranslateState()).toMatchObject({ ok: true, model: "qwen3-vl:8b", place: { base: RIG, server: { id, name: "Rig" } } });
  });
  it("GET never shows a password typed into a server address", async () => {
    await put({ action: "addServer", name: "Proxy", url: "http://me:s3cret@192.168.1.20:11434" });
    const view = JSON.stringify(await get());
    expect(view).not.toContain("s3cret");
    expect(view).toContain('"url":"http://192.168.1.20:11434"');
  });
});

const data: RolesData = {
  here: { url: HERE, elsewhere: null, reachable: true, models: [{ name: "qwen3-vl:2b", sizeBytes: 1, vision: true, chat: true, clef: false }, { name: "llama3.2:3b", sizeBytes: 1, vision: false, chat: true, clef: false }, { name: "nomic-embed-text", sizeBytes: 1, vision: false, chat: false, clef: false }] },
  servers: [{ id: "rig1", name: "Rig", url: RIG, where: "lan", warnings: ["plain"], reachable: true, models: [{ name: "clef-flash", sizeBytes: 1, vision: false, chat: true, clef: true }] }],
  pins: {},
  tasks: {} as RolesData["tasks"],
};

describe("what each task's list offers", () => {
  it("pointing: only models that read pictures can be chosen; the others say why", () => {
    const opts = ollamaGroups("okfilowPointing", data).flatMap((g) => g.options.map((o) => [o.value, o.unfit]));
    expect(opts).toEqual([["local|qwen3-vl:2b", null], ["local|llama3.2:3b", "vision"], ["local|nomic-embed-text", "chat"], ["rig1|clef-flash", "vision"]]);
  });
  it("translation: any model that writes text; decisions: Clef only", () => {
    expect(ollamaGroups("translate", data)[0].options.map((o) => o.unfit)).toEqual([null, null, "chat"]);
    expect(ollamaGroups("decision", data).flatMap((g) => g.options.filter((o) => !o.unfit).map((o) => o.value))).toEqual(["rig1|clef-flash"]);
  });
  it("speech: models on disk, usable only in a language they can listen in", () => {
    const g = speechGroup({ auto: "nemotron", active: "nemotron", pin: null, note: null, can: ["nemotron", "parakeet-v3"], language: "it" }, [
      { id: "speech:nemotron", name: "Nemotron", installed: true }, { id: "speech:reazonspeech-ja", name: "Reazon", installed: true }, { id: "speech:parakeet-v3", name: "Parakeet", installed: false }, { id: "cleanup", name: "S1", installed: true },
    ]);
    expect(g.options.map((o) => [o.value, o.unfit])).toEqual([["local|nemotron", null], ["local|reazonspeech-ja", "language"]]);
  });
  it("a pin that is not in the lists any more is still shown, as unavailable", () => {
    const groups = ollamaGroups("translate", data);
    expect(selectedValue({ source: "local", model: "gone:1b" })).toBe("local|gone:1b");
    expect(missingPin({ source: "local", model: "gone:1b" }, groups)).toBe(true);
    expect(missingPin({ source: "local", model: "llama3.2:3b" }, groups)).toBe(false);
    expect(selectedValue(null)).toBe("");
  });
});
