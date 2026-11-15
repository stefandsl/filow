import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { askRecipient, askRouteRecipient, consentKey } from "./outbound";
import { DRAW_MAX_TOKENS, DRAW_MODELS, drawTaskFor } from "./drawModels";

// The drawing role against a fake OpenRouter on loopback: which model each kind of question goes to,
// and whose yes it needs. No real key, no paid call.
vi.mock("@/lib/engineAuth", () => ({ requireEngine: () => null }));

const CAR = '```drawing2d\n{"title":"Car","shapes":[{"type":"rect","x":60,"y":120,"w":280,"h":70,"fill":"#d33a2c"},{"type":"circle","cx":120,"cy":200,"r":28,"fill":"#222222"},{"type":"circle","cx":280,"cy":200,"r":28,"fill":"#222222"}]}\n```';
const MODEL = '```model3d\n{"title":"Car","parts":[{"name":"Body","shape":"box","size":[3,0.8,1.4],"pos":[0,0.4,0],"rot":[0,0,0],"color":"#d33a2c"}]}\n```';

type Seen = { model?: string; max_tokens?: number; modalities?: string[]; messages?: Array<{ role: string; content: unknown }> };
const seen: Seen[] = [];
let reply = (_b: Seen): string => "Here it is.";
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as Seen;
      seen.push(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply(body) } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const DIR = path.join(process.cwd(), "tmp", `draw-role-${process.pid}`);
const ROLES = path.join(DIR, "model-roles.json");

beforeEach(() => {
  seen.length = 0;
  reply = (b) => (b.model === DRAW_MODELS.draw3d[0] ? MODEL : CAR);
  fs.rmSync(DIR, { recursive: true, force: true });
  for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", BUDDY_PROVIDER: "cloud", BUDDY_CLOUD_MODEL: "", OPENROUTER_API_KEY: "test-key-not-real", OPENROUTER_BASE_URL: base, FILOW_MODEL_ROLES: ROLES })) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  if (DIR.includes(`draw-role-${process.pid}`)) fs.rmSync(DIR, { recursive: true, force: true });
});

const { POST } = await import("@/app/api/buddy/ask/route");
const image = "data:image/png;base64,iVBORw0KGgo=";
const yesFor = (model: string) => consentKey("ask", askRecipient(model));
const ask = (question: string, consent: string, extra: Record<string, unknown> = {}) =>
  POST(new Request("http://127.0.0.1/api/buddy/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-filow-consent": consent },
    body: JSON.stringify({ question, provider: "cloud", language: "en", images: [image], screens: [{ index: 1, width: 10, height: 10 }], ...extra }),
  }));

describe("drawing role: each request type goes to its own online model", () => {
  it("a normal screen question stays on GPT-6 Luna, with the normal cap", async () => {
    const res = await ask("What does this button do?", yesFor("openai/gpt-6-luna"));
    await res.text();
    expect(seen.map((s) => s.model)).toEqual(["openai/gpt-6-luna"]);
    expect(seen[0].max_tokens).toBe(1500);
  });

  it("a 2D drawing goes to GPT-6 Astra", async () => {
    const res = await ask("draw a car", yesFor("openai/gpt-6-astra"));
    expect(await res.text()).toContain("drawing2d");
    expect(seen.map((s) => s.model)).toEqual(["openai/gpt-6-astra"]);
  });

  it("a 3D model goes to Gemini 3.8 Flash", async () => {
    const res = await ask("make a 3D model of a car", yesFor("google/gemini-3.8-flash"));
    expect(await res.text()).toContain("model3d");
    expect(seen.map((s) => s.model)).toEqual(["google/gemini-3.8-flash"]);
  });

  it("a 3D model with only the yes for OpenAI is refused before anything is sent", async () => {
    const res = await ask("make a 3D model of a car", yesFor("openai/gpt-6-luna"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "consent_required", recipient: askRecipient("google/gemini-3.8-flash") });
    expect(seen).toEqual([]);
  });

  it("a drawing carried on after Stop is not a new drawing: it stays on the screen model", async () => {
    const history = [{ role: "user", text: "draw a car" }, { role: "assistant", text: "Here is" }];
    const res = await ask("draw a car", yesFor("openai/gpt-6-luna"), { history, resume: true });
    await res.text();
    expect(seen.map((s) => s.model)).toEqual(["openai/gpt-6-luna"]);
  });
});

describe("drawing calls get room for a detailed picture; normal answers keep 1500", () => {
  it("2D 4000, 3D 6000 online", async () => {
    await (await ask("draw a car", yesFor("openai/gpt-6-astra"))).text();
    await (await ask("make a 3D model of a car", yesFor("google/gemini-3.8-flash"))).text();
    await (await ask("Where is Save?", yesFor("openai/gpt-6-luna"))).text();
    expect(seen.map((s) => s.max_tokens)).toEqual([DRAW_MAX_TOKENS["2d"], DRAW_MAX_TOKENS["3d"], 1500]);
    expect(DRAW_MAX_TOKENS).toEqual({ "2d": 4000, "3d": 6000 });
  });

  it("a retry after a reply with no picture keeps the drawing's model and cap", async () => {
    reply = () => "I cannot draw.";
    await (await ask("draw a car", yesFor("openai/gpt-6-astra"))).text();
    expect(seen.map((s) => [s.model, s.max_tokens])).toEqual([["openai/gpt-6-astra", 4000], ["openai/gpt-6-astra", 4000]]);
  });
});

describe("the panel names the same maker as the server", () => {
  const rec = { ask: askRecipient("openai/gpt-6-luna"), draw: { draw2d: askRecipient("openai/gpt-6-astra"), draw3d: askRecipient("google/gemini-3.8-flash") } };
  it("asks the yes for the drawing model's maker online, and the screen model otherwise", () => {
    expect(askRouteRecipient("cloud", rec, drawTaskFor("make a 3D model of a car"))).toEqual(askRecipient("google/gemini-3.8-flash"));
    expect(askRouteRecipient("cloud", rec, drawTaskFor("where is Save?"))).toEqual(askRecipient("openai/gpt-6-luna"));
    // an older server without drawing recipients: the screen model's maker, as before
    expect(askRouteRecipient("cloud", { ask: rec.ask }, "draw3d")).toEqual(rec.ask);
    // on this PC nothing changes
    expect(askRouteRecipient("local", rec, "draw3d")).toBeNull();
  });
});
