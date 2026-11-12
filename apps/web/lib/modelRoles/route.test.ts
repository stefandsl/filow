import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/local/roles/route";
import { forgetLists } from "./resolve";
import { createHmac } from "node:crypto";
import { readRoles, serverAddress } from "./store";
import { DESKTOP_HEADER } from "./view";
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

const put = (body: unknown) => PUT(new Request("http://127.0.0.1:4747/api/local/roles", { method: "PUT", body: JSON.stringify(body) }));
const get = async () => (await GET(new Request("http://127.0.0.1:4747/api/local/roles"))).json();

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
  it("only the desktop window, with this launch's token, can change where tasks run", async () => {
    vi.stubEnv("FILOW_DESKTOP_TOKEN", "launch-token-123");
    const from = (headers: Record<string, string> = {}) => PUT(new Request("http://127.0.0.1:4747/api/local/roles", { method: "PUT", headers, body: JSON.stringify({ action: "addServer", url: "10.0.0.9" }) }));
    expect((await from()).status).toBe(403);
    expect((await from({ [DESKTOP_HEADER]: "launch-token-12" })).status).toBe(403);
    expect((await from({ [DESKTOP_HEADER]: "launch-token-124" })).status).toBe(403);
    expect(readRoles(FILE).servers).toEqual([]);
    expect((await from({ [DESKTOP_HEADER]: "launch-token-123" })).status).toBe(200);
    // and reading stays open to the page
    expect((await GET(new Request("http://127.0.0.1:4747/api/local/roles"))).status).toBe(200);
  });
  it("a paired client with a valid engine token still cannot: it never has the window's token", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "pw");
    const exp = String(Date.now() + 60_000);
    const mac = createHmac("sha256", "pw").update(`phone.${exp}`).digest("base64url");
    const engine = { authorization: `Bearer ${Buffer.from("phone").toString("base64url")}.${exp}.${mac}` };
    const res = await PUT(new Request("http://127.0.0.1:4747/api/local/roles", { method: "PUT", headers: engine, body: JSON.stringify({ action: "addServer", url: "10.0.0.9" }) }));
    expect(res.status).toBe(403);
    expect(readRoles(FILE).servers).toEqual([]);
  });
  it("this PC under another spelling is not a server", async () => {
    expect(await (await put({ action: "addServer", url: "http://localhost:11434/" })).json()).toMatchObject({ code: "duplicate" });
  });
  it("offline: no server is asked, chosen or used", async () => {
    await put({ action: "addServer", name: "Rig", url: RIG });
    const id = readRoles(FILE).servers[0].id;
    await put({ action: "pin", task: "translate", pin: { source: id, model: "qwen3-vl:8b", agreed: true } });
    vi.stubEnv("FILOW_OFFLINE", "1");
    forgetLists();
    const calls = fakeOllamas({ [HERE]: [{ name: "qwen3-vl:2b", caps: ["completion", "vision"] }], [RIG]: [{ name: "qwen3-vl:8b", caps: ["completion", "vision"] }] });
    const view = await get();
    expect(view.tasks.translate).toMatchObject({ pinned: false, fallback: "offline" });
    expect(view.servers[0].reachable).toBe(false);
    expect(await (await put({ action: "pin", task: "okfilowAnswers", pin: { source: id, model: "qwen3-vl:8b", agreed: true } })).json()).toMatchObject({ code: "offline" });
    expect(calls.some((c) => c.startsWith(RIG))).toBe(false);
  });
  it("a choice saved while a server was removed does not bring the server back", async () => {
    await put({ action: "addServer", name: "Rig", url: RIG });
    const id = readRoles(FILE).servers[0].id;
    const saving = put({ action: "pin", task: "translate", pin: { source: "local", model: "llama3.2:3b" } });
    await put({ action: "removeServer", id });
    expect((await saving).status).toBe(200);
    expect(readRoles(FILE)).toEqual({ version: 1, servers: [], pins: { translate: { source: "local", model: "llama3.2:3b" } } });
  });
  describe("a server's password", () => {
    /** Stands in for Electron safeStorage: reversible, and never the plain text. */
    const box = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed|${s}`).toString("base64"), decrypt: (b: string) => Buffer.from(b, "base64").toString().replace(/^sealed\|/, "") };
    afterEach(() => { delete (globalThis as { __filowSecretBox?: unknown }).__filowSecretBox; });

    it("is kept only encrypted by the key store, used for that server's requests, never shown", async () => {
      (globalThis as { __filowSecretBox?: unknown }).__filowSecretBox = box;
      expect((await put({ action: "addServer", name: "Proxy", url: "http://me:s3cret@192.168.1.20:11434" })).status).toBe(200);
      const file = fs.readFileSync(FILE, "utf8");
      expect(file).not.toContain("s3cret");
      const server = readRoles(FILE).servers[0];
      expect(server).toMatchObject({ url: RIG, secret: box.encrypt("me:s3cret") });
      expect(serverAddress(server)).toBe("http://me:s3cret@192.168.1.20:11434");
      const view = JSON.stringify(await get());
      expect(view).not.toContain("s3cret");
      expect(view).not.toContain(server.secret!);
      expect(view).toContain(`"url":"${RIG}"`);
    });
    it("an older file with a password in clear text is rewritten encrypted on first read", () => {
      (globalThis as { __filowSecretBox?: unknown }).__filowSecretBox = box;
      fs.writeFileSync(FILE, JSON.stringify({ version: 1, servers: [{ id: "rig1", name: "Rig", url: "http://me:s3cret@192.168.1.20:11434" }], pins: {} }));
      expect(readRoles(FILE).servers[0]).toEqual({ id: "rig1", name: "Rig", url: RIG, secret: box.encrypt("me:s3cret") });
      expect(fs.readFileSync(FILE, "utf8")).not.toContain("s3cret");
    });
    it("without a key store it is refused, never written", async () => {
      expect(await (await put({ action: "addServer", url: "http://me:s3cret@192.168.1.20:11434" })).json()).toMatchObject({ code: "no_secret_store" });
      expect(fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "").not.toContain("s3cret");
      // and one already in an old file is not used, nor kept on the next write
      fs.writeFileSync(FILE, JSON.stringify({ version: 1, servers: [{ id: "rig1", name: "Rig", url: "http://me:s3cret@192.168.1.20:11434" }], pins: {} }));
      expect(readRoles(FILE).servers[0]).toEqual({ id: "rig1", name: "Rig", url: RIG });
    });
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
