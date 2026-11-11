import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/buddy/recipients/route";
import { resolveDecisionProvider } from "@/lib/decide/resolve";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsentList } from "@/app/okfilow/outbound-ui";
import { askRecipient, CONSENT_HEADER, noticeBody, signalNames, sttRecipient, type BuddyRecipients, type ConsentMap } from "./outbound";
import { EXTENSION_TEXT, remoteText } from "@/components/RemoteOutbound";
import { createPageOutbound } from "./outboundPage";
import { decideOut, kvConsentStore, screenOut, scriptOut, splitEngines, startLocalFirst, webStorageConsentStore } from "./outboundRemote";

const CHROME = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const EDGE = `${CHROME} Edg/141.0`;

const known = (over: Partial<BuddyRecipients> = {}): BuddyRecipients => ({
  offline: false,
  ask: askRecipient("google/gemini-2.5-flash"),
  voice: { id: "elevenlabs", names: ["ElevenLabs"] },
  photo: { id: "wikipedia", names: ["Wikipedia"] },
  screen: askRecipient("google/gemini-2.5-flash"),
  script: askRecipient("google/gemini-2.5-flash-lite"),
  decision: { openrouter: "google/gemini-2.5-flash-lite", cloudflare: "@cf/x" },
  defaults: { decide: "openrouter", generate: "openrouter" },
  ...over,
});

function page(initial: ConsentMap = {}) {
  let stored: ConsentMap = { ...initial };
  const out = createPageOutbound({
    store: kvConsentStore({ get: () => stored, set: (next) => { stored = next; } }),
    fetchRecipients: async () => known(),
    minMs: 0,
  });
  return { out, stored: () => stored };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("splitEngines: engines on this PC come first, the ones that send the microphone out after", () => {
  it("cloud engines and the browser's own speech engine are remote; Whisper and sherpa are local", () => {
    expect(splitEngines(["elevenlabs", "openai", "browser", "sherpa", "whisper"])).toEqual({ local: ["sherpa", "whisper"], remote: ["elevenlabs", "openai", "browser"] });
    // An engine added later is not on this PC until it is listed as such: never started without a notice.
    expect(splitEngines(["deepgram", "whisper"])).toEqual({ local: ["whisper"], remote: ["deepgram"] });
  });
});

describe("startLocalFirst: the automatic engine choice never starts a cloud or browser-maker engine without a yes", () => {
  it("starts an engine on this PC without asking anything when one is available", async () => {
    const { out } = page();
    const allow = vi.spyOn(out, "allow");
    const start = vi.fn(async (ids: string[], headers: Record<string, string>) => ({ ids, headers }));
    const r = await startLocalFirst({ available: ["elevenlabs", "browser", "whisper"], userAgent: CHROME, gate: out, start });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(["whisper"], {});
    expect(allow).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, audio: null });
    expect(out.getState().snap.active).toBe(false);
  });

  it("with no engine on this PC it asks first, naming the browser maker for Web Speech; Keep it on this PC starts nothing", async () => {
    const { out, stored } = page();
    const start = vi.fn(async () => "started");
    const pending = startLocalFirst({ available: ["browser"], userAgent: EDGE, gate: out, start });
    await flush();
    expect(out.getState().notice).toEqual({ kind: "audio", recipient: { id: "browser/microsoft", names: ["Microsoft"] } });
    await out.decide("declined");
    expect(await pending).toEqual({ ok: false, reason: "declined", kind: "audio", recipient: { id: "browser/microsoft", names: ["Microsoft"] } });
    expect(start).not.toHaveBeenCalled();
    expect(stored()["audio:browser/microsoft"]?.state).toBe("declined");
    expect(out.getState().kept).toBe("audio");
  });

  it("a yes starts that engine only, with the consent header for its token request, and the signal stays on until release", async () => {
    const { out } = page();
    const start = vi.fn(async (ids: string[], headers: Record<string, string>) => ({ ids, headers }));
    const pending = startLocalFirst({ available: ["elevenlabs", "openai", "browser"], userAgent: CHROME, gate: out, start });
    await flush();
    expect(out.getState().notice?.recipient.names).toEqual(["ElevenLabs"]);
    await out.decide("granted");
    const r = await pending;
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(["elevenlabs"], { [CONSENT_HEADER]: "audio:elevenlabs" });
    expect(r.ok).toBe(true);
    expect(out.getState().snap).toEqual({ active: true, kinds: ["audio"], names: ["ElevenLabs"] });
    if (r.ok) r.release();
    expect(out.getState().snap.active).toBe(false);
  });

  it("when the engine on this PC cannot start, it asks before any cloud engine, and never falls back silently", async () => {
    const { out } = page();
    const start = vi.fn(async (ids: string[]) => {
      if (ids.includes("whisper")) throw new Error("model download failed");
      return "cloud";
    });
    const pending = startLocalFirst({ available: ["openai", "whisper"], userAgent: CHROME, gate: out, start });
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    expect(out.getState().notice).toEqual({ kind: "audio", recipient: { id: "openai", names: ["OpenAI"] } });
    out.dismissAll();
    expect(await pending).toMatchObject({ ok: false, reason: "dismissed" });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("with no engine at all it says why, and asks nothing", async () => {
    const { out } = page();
    const r = await startLocalFirst({ available: [], userAgent: CHROME, gate: out, start: vi.fn() });
    expect(r).toEqual({ ok: false, reason: "failed", error: "no speech-to-text engine is available here" });
    expect(out.getState().notice).toBeNull();
  });

  it("a stored yes starts the cloud engine without a notice; a cloud engine that fails releases the signal", async () => {
    const { out } = page({ "audio:openai": { state: "granted", at: "x", names: ["OpenAI"] } });
    await out.load();
    const r = await startLocalFirst({ available: ["openai"], userAgent: CHROME, gate: out, start: async () => { throw new Error("token refused"); } });
    expect(r).toEqual({ ok: false, reason: "failed", error: "token refused" });
    expect(out.getState().snap.active).toBe(false);
  });
});

describe("review fixes", () => {
  it("an engine that sends out but has no known recipient is never started", async () => {
    const { out } = page();
    const start = vi.fn();
    const r = await startLocalFirst({ available: ["deepgram"], userAgent: CHROME, gate: out, start });
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(start).not.toHaveBeenCalled();
    expect(out.getState().notice).toBeNull();
  });

  it("a yes withdrawn between the answer and the start starts nothing and leaves no signal on", async () => {
    const start = vi.fn();
    const gate = { allow: async () => "granted" as const, header: () => ({}), hold: () => { throw new Error("consent_required"); } };
    const r = await startLocalFirst({ available: ["openai"], userAgent: CHROME, gate, start });
    expect(r).toEqual({ ok: false, reason: "failed", error: "consent_required" });
    expect(start).not.toHaveBeenCalled();
  });

  it("when OpenRouter picks the host, the signal names only OpenRouter and the list says who picks", async () => {
    const picked = askRecipient("meta-llama/llama-3.3-70b-instruct");
    const { out } = page({ [`script:${picked.id}`]: { state: "granted", at: "x", names: picked.names } });
    await out.load();
    let during: unknown = null;
    await out.sending("script", picked, async () => { during = out.getState().snap; });
    expect(during).toEqual({ active: true, kinds: ["script"], names: ["OpenRouter"] });
    const html = renderToStaticMarkup(createElement(ConsentList, { consent: out.getState().consent, t: remoteText("en"), onForget: () => {} }));
    expect(html).toContain("to OpenRouter and Meta (run by a company OpenRouter picks)");
    // A maker that runs its own model is named in the signal as before.
    expect(signalNames(askRecipient("google/gemini-2.5-flash"))).toEqual(["OpenRouter", "Google"]);
  });

  it("Apple's web view (Office for Mac) is named Apple for Web Speech", () => {
    const officeMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    expect(sttRecipient("browser", officeMac)).toEqual({ id: "browser/apple", names: ["Apple"] });
  });
});

describe("who receives what when the server picks the engine", () => {
  it("script: the cloud writer's recipients, nobody when the server writes on this PC or is offline", () => {
    expect(scriptOut(known())).toEqual(askRecipient("google/gemini-2.5-flash-lite"));
    expect(scriptOut(known({ defaults: { decide: "openrouter", generate: "ollama" } }))).toBeNull();
    expect(scriptOut(known({ offline: true }))).toBeNull();
    // An older server that does not say: ask rather than surprise.
    expect(scriptOut(known({ defaults: undefined }))).toEqual(askRecipient("google/gemini-2.5-flash-lite"));
  });

  it("decisions: OpenRouter and the model's maker, Cloudflare, or nobody for the local decider", () => {
    expect(decideOut(known())).toEqual(askRecipient("google/gemini-2.5-flash-lite"));
    expect(decideOut(known({ defaults: { decide: "clef-cloudflare", generate: "openrouter" } }))).toEqual({ id: "cloudflare", names: ["Cloudflare"] });
    expect(decideOut(known({ defaults: { decide: "clef-local", generate: "openrouter" } }))).toBeNull();
    expect(decideOut(known({ offline: true }))).toBeNull();
  });

  it("screen pictures: the vision model's recipients, nobody offline", () => {
    expect(screenOut(known())).toEqual(askRecipient("google/gemini-2.5-flash"));
    expect(screenOut(known({ offline: true }))).toBeNull();
  });
});

describe("GET /api/buddy/recipients tells a client that does not choose what the server would run", () => {
  const keys = ["DECISION_PROVIDER", "GENERATE_PROVIDER", "FILOW_OFFLINE"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => { for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });

  it("the cloud by default, the local decider and writer when set, only local ones offline", async () => {
    for (const k of keys) delete process.env[k];
    expect(((await (await GET()).json()) as BuddyRecipients).defaults).toEqual({ decide: "openrouter", generate: "openrouter" });
    process.env.DECISION_PROVIDER = "clef-local";
    expect(((await (await GET()).json()) as BuddyRecipients).defaults).toEqual({ decide: "clef-local", generate: "ollama" });
    process.env.DECISION_PROVIDER = "clef-cloudflare";
    process.env.GENERATE_PROVIDER = "ollama";
    expect(((await (await GET()).json()) as BuddyRecipients).defaults).toEqual({ decide: "clef-cloudflare", generate: "ollama" });
    process.env.FILOW_OFFLINE = "1";
    expect(((await (await GET()).json()) as BuddyRecipients).defaults).toEqual({ decide: "clef-local", generate: "ollama" });
  });

  it("the decide route uses the same default, so the notice names who the words really go to", () => {
    for (const k of keys) delete process.env[k];
    process.env.DECISION_PROVIDER = "not-a-provider";
    expect(resolveDecisionProvider()).toBe("openrouter");
    expect(resolveDecisionProvider("clef-cloudflare")).toBe("clef-cloudflare");
    expect(resolveDecisionProvider("matcher")).toBe("openrouter");
  });
});

describe("what the add-in and the extension say", () => {
  it("point at their own list, not at OK Filow's settings; the extension speaks of the tab it follows", () => {
    const t = remoteText("en");
    expect(t("consentEmpty")).toBe("Nothing yet. Filow asks before the first send.");
    expect(t("noticeRememberHere")).toContain("in this pane");
    const ext = remoteText("it", EXTENSION_TEXT);
    const r = askRecipient("google/gemini-2.5-flash");
    expect(noticeBody({ kind: "screen", recipient: r }, ext)).toBe("Mentre segui la presentazione, un'immagine della scheda e il titolo della slide vanno a OpenRouter e poi a Google, che produce il modello che hai scelto, che dice a Filow cosa c'è sopra.");
    expect(ext("kind_screen")).toBe("Immagini della scheda seguita");
    // A language without these strings yet reads English, never a missing key.
    expect(remoteText("xx")("noticeKeep")).toBe("Keep it on this PC"); // an unknown language reads English
    expect(remoteText("ja")("noticeKeep")).not.toBe("Keep it on this PC");
  });
});

describe("where the add-in and the extension keep the choices", () => {
  it("merges this pane's change into what is stored now, so another pane's choice survives", async () => {
    let stored: ConsentMap = { "script:openrouter/google": { state: "granted", at: "a", names: ["OpenRouter", "Google"] } };
    const store = kvConsentStore({ get: async () => stored, set: async (n) => { stored = n; } });
    const after = await store.write({ "screen:openrouter/google": { state: "declined", at: "b", names: ["OpenRouter", "Google"] } }, {});
    expect(Object.keys(after ?? {}).sort()).toEqual(["screen:openrouter/google", "script:openrouter/google"]);
    expect(stored).toEqual(after);
  });

  it("a choice that could not be stored is reported as not stored (and so is not a yes)", async () => {
    const store = kvConsentStore({ get: () => ({}), set: () => { throw new Error("quota"); } });
    expect(await store.write({ "audio:openai": { state: "granted", at: "x", names: ["OpenAI"] } }, {})).toBeNull();
    const { out } = (() => {
      const o = createPageOutbound({ store, fetchRecipients: async () => known(), minMs: 0 });
      return { out: o };
    })();
    const pending = out.allow("audio", { id: "openai", names: ["OpenAI"] });
    await flush();
    await out.decide("granted");
    expect(await pending).toBe("dismissed");
  });

  it("reads a damaged localStorage entry as no choices", async () => {
    const mem = new Map<string, string>([["k", "{not json"]]);
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } as unknown as Storage;
    const store = webStorageConsentStore(() => storage, "k");
    expect(await store.read()).toEqual({});
    await store.write({ "audio:openai": { state: "granted", at: "x", names: ["OpenAI"] } }, {});
    expect(JSON.parse(mem.get("k")!)).toHaveProperty("audio:openai");
  });
});
