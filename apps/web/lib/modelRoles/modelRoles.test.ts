import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canSee, unfitFor, type OllamaModelInfo } from "./tasks";
import { normaliseServerUrl, redactUrl, serverName, serverWarnings, whereIs } from "./servers";
import { cleanRoles, readRoles, writeRoles, type RolesFile } from "./store";
import { forgetLists, listSource, requestParts, taskTarget } from "./resolve";
import { pinHelper } from "./helper";

const m = (name: string, capabilities: string[] | null = null): OllamaModelInfo => ({ name, capabilities });

describe("which models can do a task", () => {
  it("only a model that reads pictures can answer about the screen or point", () => {
    expect(unfitFor("vision", m("qwen3-vl:2b", ["completion", "vision"]))).toBeNull();
    expect(unfitFor("vision", m("llama3.1:8b", ["completion", "tools"]))).toBe("vision");
    // an Ollama too old to say: the name decides
    expect(unfitFor("vision", m("gemma4:e4b"))).toBeNull();
    expect(unfitFor("vision", m("gemma3:1b"))).toBe("vision");
    expect(unfitFor("vision", m("mistral:7b"))).toBe("vision");
  });
  it("an embedding model writes no text: it can do nothing here", () => {
    expect(unfitFor("chat", m("nomic-embed-text", ["embedding"]))).toBe("chat");
    expect(unfitFor("chat", m("mxbai-embed-large"))).toBe("chat");
    expect(unfitFor("vision", m("nomic-embed-text", ["embedding"]))).toBe("chat");
    expect(unfitFor("chat", m("llama3.1:8b", ["completion"]))).toBeNull();
  });
  it("only Clef ticks points; Clef does nothing else that needs pictures", () => {
    expect(unfitFor("clef", m("clef-flash:latest"))).toBeNull();
    expect(unfitFor("clef", m("clef"))).toBeNull();
    expect(unfitFor("clef", m("gemma4:e4b", ["completion", "vision"]))).toBe("clef");
    expect(canSee(m("clef-flash", ["completion"]))).toBe(false);
  });
});

describe("the user's servers", () => {
  it("an address without a scheme is http; anything but http or https is refused", () => {
    expect(normaliseServerUrl("192.168.1.20:11434")).toEqual({ ok: true, url: "http://192.168.1.20:11434" });
    expect(normaliseServerUrl(" https://rig.local:11434/?x=1#y ")).toEqual({ ok: true, url: "https://rig.local:11434" });
    expect(normaliseServerUrl("ftp://rig")).toEqual({ ok: false, reason: "scheme" });
    expect(normaliseServerUrl("file:///c:/x")).toEqual({ ok: false, reason: "scheme" });
    expect(normaliseServerUrl("")).toEqual({ ok: false, reason: "empty" });
    expect(normaliseServerUrl("http://")).toEqual({ ok: false, reason: "invalid" });
  });
  it("tells this PC, the home network and the internet apart", () => {
    expect(whereIs("http://127.0.0.1:11434")).toBe("this-pc");
    expect(whereIs("http://localhost:11434")).toBe("this-pc");
    for (const lan of ["http://192.168.1.20:11434", "http://10.0.0.5", "http://172.20.1.1", "http://rig.local", "http://rig", "http://100.101.1.2", "http://[fd00::1]:11434"]) expect(whereIs(lan)).toBe("lan");
    for (const far of ["http://8.8.8.8", "https://ollama.example.com", "http://172.32.0.1", "http://[2001:db8::1]"]) expect(whereIs(far)).toBe("internet");
  });
  it("warns about plain http off this PC and about the internet", () => {
    expect(serverWarnings("http://192.168.1.20:11434")).toEqual(["plain"]);
    expect(serverWarnings("https://192.168.1.20")).toEqual([]);
    expect(serverWarnings("https://ollama.example.com")).toEqual(["internet"]);
    expect(serverWarnings("http://ollama.example.com")).toEqual(["plain", "internet"]);
    expect(serverWarnings("http://127.0.0.1:11434")).toEqual([]);
  });
  it("a password in the address is never shown, and only becomes a header for that server", () => {
    expect(redactUrl("https://me:s3cret@rig.example.com:8443")).toBe("https://rig.example.com:8443");
    expect(requestParts("https://me:s3cret@rig.example.com:8443")).toEqual({ base: "https://rig.example.com:8443", headers: { Authorization: `Basic ${Buffer.from("me:s3cret").toString("base64")}` } });
    expect(requestParts("http://rig:11434")).toEqual({ base: "http://rig:11434", headers: {} });
  });
  it("a server without a name is called by its host", () => {
    expect(serverName("  My   rig ", "http://10.0.0.5")).toBe("My rig");
    expect(serverName("", "http://10.0.0.5:11434")).toBe("10.0.0.5");
    expect(serverName("x".repeat(80), "http://a").length).toBe(40);
  });
});

const DIR = path.join(process.cwd(), "tmp", `model-roles-test-${process.pid}`);
const FILE = path.join(DIR, "model-roles.json");

describe("the choices survive a restart", () => {
  afterAll(() => {
    // only the folder this test made
    if (DIR.includes(`model-roles-test-${process.pid}`)) fs.rmSync(DIR, { recursive: true, force: true });
  });
  it("what is written is read back, from the file", () => {
    const value: RolesFile = { version: 1, servers: [{ id: "rig1", name: "Rig", url: "http://192.168.1.20:11434" }], pins: { translate: { source: "rig1", model: "llama3.1:8b", agreed: true }, tracking: { source: "local", model: "parakeet-v3" } } };
    writeRoles(value, FILE);
    expect(JSON.parse(fs.readFileSync(FILE, "utf8"))).toEqual(value);
    expect(readRoles(FILE)).toEqual(value);
  });
  it("a missing or broken file means nothing was chosen", () => {
    expect(readRoles(path.join(DIR, "none.json"))).toEqual({ version: 1, pins: {}, servers: [] });
    fs.writeFileSync(path.join(DIR, "broken.json"), "{not json");
    expect(readRoles(path.join(DIR, "broken.json"))).toEqual({ version: 1, pins: {}, servers: [] });
  });
  it("a pin to a server that is gone goes with it; a bad entry is dropped, not fatal", () => {
    const cleaned = cleanRoles({
      servers: [{ id: "rig1", name: "Rig", url: "ftp://x" }, { id: "srv", name: "", url: "10.0.0.9" }, { id: "local", name: "Me", url: "http://10.0.0.3" }],
      pins: { translate: { source: "rig1", model: "a" }, generate: { source: "srv", model: "b", agreed: true }, nonsense: { source: "local", model: "c" }, decision: { source: "local", model: "" }, whiteboard: { source: "local", model: "d", agreed: true } },
    });
    expect(cleaned.servers).toEqual([{ id: "srv", name: "10.0.0.9", url: "http://10.0.0.9" }]);
    // "agreed" only means something for a server
    expect(cleaned.pins).toEqual({ generate: { source: "srv", model: "b", agreed: true }, whiteboard: { source: "local", model: "d" } });
  });
});

/** A fake Ollama per address: its models and whether it answers. */
function fakeOllamas(hosts: Record<string, { up: boolean; models: Array<{ name: string; caps?: string[] }> }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const host = Object.keys(hosts).find((h) => url.startsWith(h));
    if (!host || !hosts[host].up) throw new TypeError("fetch failed");
    if (url.endsWith("/api/tags")) return Response.json({ models: hosts[host].models.map((x) => ({ name: x.name, size: 1, digest: x.name })) });
    if (url.endsWith("/api/show")) {
      const name = JSON.parse(String(init?.body)).model;
      return Response.json({ capabilities: hosts[host].models.find((x) => x.name === name)?.caps ?? ["completion"] });
    }
    return new Response("{}", { status: 404 });
  }));
  return calls;
}

const HERE = "http://127.0.0.1:11434";
const RIG = "http://192.168.1.20:11434";
const roles = (pins: RolesFile["pins"]): RolesFile => ({ version: 1, servers: [{ id: "rig1", name: "Rig", url: RIG }], pins });

describe("where a task runs", () => {
  beforeEach(() => {
    forgetLists();
    vi.stubEnv("OLLAMA_URL", HERE);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("nothing pinned: the automatic pick on this PC", async () => {
    fakeOllamas({ [HERE]: { up: true, models: [] } });
    expect(await taskTarget("translate", "gemma4:e2b", roles({}))).toMatchObject({ base: HERE, model: "gemma4:e2b", pinned: false, fallback: null, server: null });
  });
  it("a pin to the user's server sends the task there, with that server's own password only", async () => {
    const calls = fakeOllamas({ [HERE]: { up: true, models: [] }, ["http://192.168.1.20:11434"]: { up: true, models: [{ name: "llama3.1:8b" }] } });
    const r: RolesFile = { version: 1, servers: [{ id: "rig1", name: "Rig", url: "http://me:pw@192.168.1.20:11434" }], pins: { translate: { source: "rig1", model: "llama3.1:8b", agreed: true } } };
    const t = await taskTarget("translate", "gemma4:e2b", r);
    expect(t).toMatchObject({ base: RIG, model: "llama3.1:8b", pinned: true, fallback: null, server: { id: "rig1", name: "Rig" } });
    expect(t.headers.Authorization).toMatch(/^Basic /);
    // nothing about the server ever went to this PC's Ollama, and no call carried the password in its address
    expect(calls.every((c) => !c.url.includes("pw@"))).toBe(true);
    expect(calls.filter((c) => c.url.startsWith(HERE)).every((c) => !c.headers.Authorization)).toBe(true);
  });
  it("a pin on this PC that was deleted falls back to automatic, saying so", async () => {
    fakeOllamas({ [HERE]: { up: true, models: [{ name: "gemma4:e4b" }] } });
    expect(await taskTarget("translate", "gemma4:e4b", roles({ translate: { source: "local", model: "qwen3:8b" } }))).toMatchObject({ base: HERE, model: "gemma4:e4b", pinned: false, fallback: "missing" });
  });
  it("a server that does not answer: automatic on this PC, never another server or the cloud", async () => {
    fakeOllamas({ [HERE]: { up: true, models: [] }, [RIG]: { up: false, models: [] } });
    expect(await taskTarget("generate", "gemma4:e2b", roles({ generate: { source: "rig1", model: "qwen3-vl:8b", agreed: true } }))).toMatchObject({ base: HERE, model: "gemma4:e2b", server: null, fallback: "unreachable" });
  });
  it("no yes for the server: nothing goes there", async () => {
    const calls = fakeOllamas({ [HERE]: { up: true, models: [] }, [RIG]: { up: true, models: [{ name: "llama3.1:8b" }] } });
    expect(await taskTarget("translate", null, roles({ translate: { source: "rig1", model: "llama3.1:8b" } }))).toMatchObject({ base: HERE, fallback: "unagreed" });
    expect(calls.some((c) => c.url.startsWith(RIG))).toBe(false);
  });
  it("a model that cannot see is never used for pointing, even when pinned by hand", async () => {
    fakeOllamas({ [HERE]: { up: true, models: [{ name: "llama3.1:8b", caps: ["completion"] }] } });
    expect(await taskTarget("okfilowPointing", "qwen3-vl:2b", roles({ okfilowPointing: { source: "local", model: "llama3.1:8b" } }))).toMatchObject({ model: "qwen3-vl:2b", fallback: "unfit" });
  });
  it("lists a server's models with what each can do, and its address without a password", async () => {
    const calls = fakeOllamas({ ["https://rig.example.com"]: { up: true, models: [{ name: "qwen3-vl:8b", caps: ["completion", "vision"] }] } });
    const list = await listSource("https://me:pw@rig.example.com");
    expect(list).toEqual({ reachable: true, models: [{ name: "qwen3-vl:8b", sizeBytes: 1, capabilities: ["completion", "vision"] }] });
    expect(calls.map((c) => c.url)).toEqual(["https://rig.example.com/api/tags", "https://rig.example.com/api/show"]);
  });
});

describe("OK Filow and the whiteboard with the user's choices", () => {
  beforeEach(() => {
    forgetLists();
    vi.stubEnv("OLLAMA_URL", HERE);
    fakeOllamas({
      [HERE]: { up: true, models: [{ name: "qwen3-vl:2b", caps: ["completion", "vision"] }, { name: "gemma4:e4b", caps: ["completion", "vision"] }, { name: "llama3.1:8b", caps: ["completion"] }] },
      [RIG]: { up: true, models: [{ name: "qwen3-vl:8b", caps: ["completion", "vision"] }] },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const auto = { model: "qwen3-vl:2b", pictures: true };

  it("nothing pinned: the setup's helper, unchanged", async () => {
    expect(await pinHelper(auto, { task: "okfilowAnswers", pointOnly: false, roles: roles({}) })).toEqual(auto);
  });
  it("answers on the pinned model; points on the pinned pointing model on the user's server", async () => {
    const h = await pinHelper({ ...auto, pointer: "qwen3-vl:2b" }, { task: "okfilowAnswers", pointOnly: false, setupPointer: "qwen3-vl:2b", roles: roles({ okfilowAnswers: { source: "local", model: "gemma4:e4b" }, okfilowPointing: { source: "rig1", model: "qwen3-vl:8b", agreed: true } }) });
    expect(h.model).toBe("gemma4:e4b");
    expect(h.at?.server).toBeNull();
    expect(h.pointer).toBe("qwen3-vl:8b");
    expect(h.pointerAt).toMatchObject({ base: RIG, server: { id: "rig1", name: "Rig" } });
  });
  it("a \"where is it\" question goes to the pinned pointing model", async () => {
    const h = await pinHelper(auto, { task: "okfilowAnswers", pointOnly: true, roles: roles({ okfilowPointing: { source: "rig1", model: "qwen3-vl:8b", agreed: true } }) });
    expect(h).toMatchObject({ model: "qwen3-vl:8b", pictures: true, at: { base: RIG } });
  });
  it("with the screen switched off, no pointing", async () => {
    const h = await pinHelper({ model: "qwen3-vl:2b", pictures: false }, { task: "okfilowAnswers", pointOnly: true, sees: false, roles: roles({ okfilowPointing: { source: "local", model: "gemma4:e4b" } }) });
    expect(h).toEqual({ model: "qwen3-vl:2b", pictures: false });
  });
  it("a pin keeps OK Filow alive where the setup had no model at all", async () => {
    const none = new Error("too little memory");
    await expect(pinHelper(none, { task: "okfilowAnswers", pointOnly: false, roles: roles({}) })).rejects.toBe(none);
    expect(await pinHelper(none, { task: "okfilowAnswers", pointOnly: false, roles: roles({ okfilowAnswers: { source: "local", model: "gemma4:e4b" } }) })).toMatchObject({ model: "gemma4:e4b", pictures: true });
  });
  it("the whiteboard follows its own pin, not OK Filow's", async () => {
    const r = roles({ whiteboard: { source: "local", model: "llama3.1:8b" }, okfilowAnswers: { source: "local", model: "gemma4:e4b" } });
    expect((await pinHelper(auto, { task: "whiteboard", pointOnly: false, roles: r })).model).toBe("llama3.1:8b");
    expect((await pinHelper(auto, { task: "okfilowAnswers", pointOnly: false, roles: r })).model).toBe("gemma4:e4b");
  });
  it("a pinned answering model that was deleted leaves the setup's own", async () => {
    expect(await pinHelper(auto, { task: "okfilowAnswers", pointOnly: false, roles: roles({ okfilowAnswers: { source: "local", model: "gone:7b" } }) })).toEqual(auto);
  });
});
