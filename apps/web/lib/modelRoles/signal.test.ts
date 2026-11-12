import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askRouteRecipient, consentKey, CONSENT_HEADER, decisionRecipient, isServerRecipient, localServer, noticeBody, serverRecipient, takeOutbound } from "@/lib/buddy/outbound";
import { okfText } from "@/lib/buddy/text";
import { GET as recipientsGET } from "@/app/api/buddy/recipients/route";
import { POST as decidePOST } from "@/app/api/decide/route";
import { serverAllowed } from "./helper";
import { forgetLists } from "./resolve";

const rig = serverRecipient({ id: "rig1", name: "Rig" });

describe("a task on the user's own server leaves this PC, and says so", () => {
  it("on \"Local\", OK Filow's question goes to the server when one is chosen, else nowhere", () => {
    const ask = { id: "openrouter/google", names: ["OpenRouter", "Google"] };
    expect(askRouteRecipient("local", { ask, server: rig })).toEqual(rig);
    expect(askRouteRecipient("local", { ask })).toBeNull();
    expect(askRouteRecipient("cloud", { ask, server: rig })).toEqual(ask);
  });
  it("the take asks before its words go to a decision model on the server", () => {
    const models = { openrouter: "x", cloudflare: "y", local: rig };
    expect(decisionRecipient("clef-local", models)).toEqual(rig);
    expect(decisionRecipient("clef-local", { openrouter: "x", cloudflare: "y" })).toBeNull();
    expect(takeOutbound({ backend: "sherpa", provider: "clef-local", models })).toEqual([{ kind: "transcript", recipient: rig }]);
  });
  it("the notice and the signal name \"your server <name>\" in the user's language; the yes stays tied to the server", () => {
    for (const [lang, words] of [["en", "your server Rig"], ["it", "il tuo server Rig"], ["ru", "ваш сервер Rig"], ["ro", "serverul tău Rig"], ["ja", "あなたのサーバー Rig"]] as const) {
      const named = localServer(rig, okfText(lang)("outServer"));
      expect(named.names).toEqual([words]);
      expect(consentKey("ask", named)).toBe("ask:server:rig1");
      expect(noticeBody({ kind: "ask", recipient: named }, okfText(lang) as never)).toContain(words);
    }
    expect(isServerRecipient(rig)).toBe(true);
    expect(localServer({ id: "openrouter", names: ["OpenRouter"] }, "your server {name}").names).toEqual(["OpenRouter"]);
  });
  it("a helper that would reach a server is used only with the yes for that server", () => {
    const at = { base: "http://10.0.0.5:11434", headers: {}, server: { id: "rig1", name: "Rig" } };
    expect(serverAllowed({ model: "m", pictures: true }, undefined)).toBe(true);
    expect(serverAllowed({ model: "m", pictures: true, at }, undefined)).toBe(false);
    expect(serverAllowed({ model: "m", pictures: true, at }, "ask:openrouter/google")).toBe(false);
    expect(serverAllowed({ model: "m", pictures: true, at }, "ask:server:rig1")).toBe(true);
    // pointing on a second server needs its own yes
    expect(serverAllowed({ model: "m", pictures: true, at, pointer: "p", pointerAt: { ...at, server: { id: "lab", name: "Lab" } } }, "ask:server:rig1")).toBe(false);
  });
});

const DIR = path.join(process.cwd(), "tmp", `model-roles-signal-${process.pid}`);
const FILE = path.join(DIR, "model-roles.json");
const HERE = "http://127.0.0.1:11434";
const RIG = "http://192.168.1.20:11434";

describe("the routes", () => {
  const calls: string[] = [];
  beforeEach(() => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ version: 1, servers: [{ id: "rig1", name: "Rig", url: RIG }], pins: { okfilowAnswers: { source: "rig1", model: "qwen3-vl:8b", agreed: true }, decision: { source: "rig1", model: "clef-flash", agreed: true } } }));
    forgetLists();
    calls.length = 0;
    for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_MODEL_ROLES: FILE, OLLAMA_URL: HERE, FILOW_OFFLINE: "", DECISION_PROVIDER: "" })) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(HERE)) return Response.json({ models: [] });
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3-vl:8b", digest: "a" }, { name: "clef-flash:latest", digest: "b" }] });
      if (url.endsWith("/api/show")) return Response.json({ capabilities: JSON.parse(String(init?.body)).model.startsWith("qwen") ? ["completion", "vision"] : ["completion"] });
      if (url.endsWith("/v1/systemone")) return Response.json({ answers: {} });
      return new Response("{}", { status: 404 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(() => {
    if (DIR.includes(`model-roles-signal-${process.pid}`)) fs.rmSync(DIR, { recursive: true, force: true });
  });

  it("GET /api/buddy/recipients names the server for OK Filow and for the take's decisions", async () => {
    const rec = await (await recipientsGET()).json();
    expect(rec.server).toEqual(rig);
    expect(rec.decision.local).toEqual(rig);
  });
  it("offline, no server is named (nothing goes there)", async () => {
    vi.stubEnv("FILOW_OFFLINE", "1");
    const rec = await (await recipientsGET()).json();
    expect(rec.server).toBeUndefined();
    expect(rec.decision.local).toBeUndefined();
  });
  it("decisions go to the server only with the take's yes for it", async () => {
    const body = JSON.stringify({ provider: "clef-local", bullets: [{ id: "b1", text: "Intro" }], transcript: "hello" });
    const refused = await decidePOST(new Request("http://127.0.0.1/api/decide", { method: "POST", body }));
    expect(refused.status).toBe(403);
    expect(calls.some((c) => c.endsWith("/v1/systemone"))).toBe(false);
    await decidePOST(new Request("http://127.0.0.1/api/decide", { method: "POST", headers: { [CONSENT_HEADER]: "transcript:server:rig1" }, body }));
    expect(calls).toContain(`${RIG}/v1/systemone`);
  });
});
