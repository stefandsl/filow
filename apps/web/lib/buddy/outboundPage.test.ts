import { describe, expect, it, vi } from "vitest";
import { askRecipient, CONSENT_HEADER, sttRecipient, withConsent, type BuddyRecipients, type ConsentMap, type Recipient } from "./outbound";
import { NoConsentError } from "./outboundClient";
import { createPageOutbound } from "./outboundPage";

const google = askRecipient("google/gemini-2.5-flash-lite");
const eleven = sttRecipient("elevenlabs") as Recipient;
const recipients: BuddyRecipients = { offline: false, ask: google, voice: eleven, photo: eleven, screen: google, script: google, decision: { openrouter: "google/gemini-2.5-flash-lite", cloudflare: "@cf/x/y" } };

/** The take page in miniature: a store another window can change, a clock, and timers run by hand. */
function rig(start: ConsentMap = {}, opts: { writeFails?: boolean } = {}) {
  const world = { stored: start, clock: 0, timers: [] as Array<{ at: number; fn: () => void }>, writes: 0 };
  const out = createPageOutbound({
    store: {
      read: async () => world.stored,
      write: async (next) => {
        if (opts.writeFails) return false;
        world.stored = next;
        world.writes++;
        return true;
      },
    },
    fetchRecipients: async () => recipients,
    minMs: 1200,
    now: () => world.clock,
    later: (fn, ms) => world.timers.push({ at: world.clock + ms, fn }),
  });
  const advance = (ms: number) => {
    world.clock += ms;
    for (const timer of world.timers.splice(0)) {
      if (timer.at <= world.clock) timer.fn();
      else world.timers.push(timer);
    }
  };
  return { out, world, advance };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("a take that would send the microphone outside", () => {
  it("Keep it on this PC: no header, no stream, no signal, and the no is not remembered as a yes", async () => {
    const { out } = rig();
    const asked = out.allow("audio", eleven);
    await flush();
    expect(out.getState().notice).toEqual({ kind: "audio", recipient: eleven });
    await out.decide("declined");
    expect(await asked).toBe("declined");
    expect(out.header("audio", eleven)).toEqual({});
    expect(() => out.hold("audio", eleven)).toThrow(NoConsentError);
    const send = vi.fn(async () => "sent");
    await expect(out.sending("audio", eleven, send)).rejects.toBeInstanceOf(NoConsentError);
    expect(send).not.toHaveBeenCalled();
    expect(out.getState().snap.active).toBe(false);
    expect(out.getState().notice).toBeNull();
  });

  it("closing the notice stores nothing and sends nothing", async () => {
    const { out, world } = rig();
    const asked = out.allow("audio", eleven);
    await flush();
    await out.decide("dismissed");
    expect(await asked).toBe("dismissed");
    expect(world.stored).toEqual({});
    expect(out.header("audio", eleven)).toEqual({});
  });

  it("Send: the header carries the key, and the signal names the recipient until the take ends", async () => {
    const { out, world, advance } = rig();
    const asked = out.allow("audio", eleven);
    await flush();
    await out.decide("granted");
    expect(await asked).toBe("granted");
    expect(world.stored["audio:elevenlabs"].state).toBe("granted");
    expect(out.header("audio", eleven)).toEqual({ [CONSENT_HEADER]: "audio:elevenlabs" });
    const release = out.hold("audio", eleven);
    expect(out.getState().snap).toEqual({ active: true, kinds: ["audio"], names: ["ElevenLabs"] });
    advance(60_000);
    expect(out.getState().snap.active).toBe(true);
    release();
    release();
    expect(out.getState().snap).toEqual({ active: false, kinds: [], names: [] });
  });

  it("a yes that could not be stored is not a yes", async () => {
    const { out } = rig({}, { writeFails: true });
    const asked = out.allow("audio", eleven);
    await flush();
    await out.decide("granted");
    expect(await asked).toBe("dismissed");
    expect(out.header("audio", eleven)).toEqual({});
    expect(() => out.hold("audio", eleven)).toThrow(NoConsentError);
  });

  it("a yes for the microphone does not cover the words, or another maker", async () => {
    const { out } = rig(withConsent({}, "audio", eleven, "granted"));
    await out.load();
    expect(out.header("transcript", google)).toEqual({});
    expect(out.header("audio", sttRecipient("openai"))).toEqual({});
    expect(() => out.hold("transcript", google)).toThrow(NoConsentError);
  });
});

describe("the signal on the page", () => {
  const both = withConsent(withConsent({}, "audio", eleven, "granted"), "transcript", google, "granted");

  it("names every recipient of the running take once, and drops each when its stream ends", async () => {
    const { out, advance } = rig(both);
    await out.load();
    const mic = out.hold("audio", eleven);
    const words = out.hold("transcript", google);
    expect(out.getState().snap).toEqual({ active: true, kinds: ["audio", "transcript"], names: ["ElevenLabs", "OpenRouter", "Google"] });
    advance(5000);
    mic();
    expect(out.getState().snap).toEqual({ active: true, kinds: ["transcript"], names: ["OpenRouter", "Google"] });
    words();
    expect(out.getState().snap.active).toBe(false);
  });

  it("a send that ends at once is still shown long enough to be seen, then goes away", async () => {
    const { out, advance } = rig(withConsent({}, "script", google, "granted"));
    await out.load();
    const seen: boolean[] = [];
    out.subscribe(() => seen.push(out.getState().snap.active));
    expect(await out.sending("script", google, async (headers) => headers[CONSENT_HEADER])).toBe("script:openrouter/google");
    expect(out.getState().snap).toEqual({ active: true, kinds: ["script"], names: ["OpenRouter", "Google"] });
    advance(1199);
    expect(out.getState().snap.active).toBe(true);
    advance(1);
    expect(out.getState().snap.active).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("a request answered on this PC drops the signal at once", async () => {
    const { out } = rig(withConsent({}, "screen", google, "granted"));
    await out.load();
    await out.sending("screen", google, async (_headers, quiet) => { quiet(); });
    expect(out.getState().snap.active).toBe(false);
  });

  it("is never shown when nothing was allowed", async () => {
    const { out } = rig();
    const seen: boolean[] = [];
    out.subscribe(() => seen.push(out.getState().snap.active));
    await out.load();
    expect(() => out.hold("audio", eleven)).toThrow();
    expect(seen).not.toContain(true);
  });
});

describe("choices shared with the OK Filow settings", () => {
  it("a yes withdrawn in another window stops the header and brings the notice back", async () => {
    const { out, world } = rig(withConsent({}, "transcript", google, "granted"));
    await out.load();
    out.setRoute("transcript", google);
    expect(out.routeHeader("transcript")).toEqual({ [CONSENT_HEADER]: "transcript:openrouter/google" });
    world.stored = {};
    await out.load();
    expect(out.getState().consent).toEqual({});
    expect(out.routeHeader("transcript")).toEqual({});
    void out.allow("transcript", google);
    await flush();
    expect(out.getState().notice).toEqual({ kind: "transcript", recipient: google });
  });

  it("the route of a take that stays on this PC carries no header", async () => {
    const { out } = rig(withConsent({}, "transcript", google, "granted"));
    await out.load();
    expect(out.routeHeader("transcript")).toEqual({});
    out.setRoute("transcript", google);
    out.setRoute("transcript", null);
    expect(out.route("transcript")).toBeNull();
    expect(out.routeHeader("transcript")).toEqual({});
  });

  it("names the recipients from the server", async () => {
    const { out } = rig();
    expect((await out.recipients())?.decision.openrouter).toBe("google/gemini-2.5-flash-lite");
  });
});
