import { describe, expect, it, vi } from "vitest";
import { askRecipient, CONSENT_HEADER, photoRecipient, voiceRecipient, withConsent, type BuddyRecipients, type ConsentMap, type KeepLocalPatch, type NoticeRequest } from "./outbound";
import { createOutboundController, NoConsentError } from "./outboundClient";

const google = askRecipient("google/gemini-2.5-flash");
const recipients: BuddyRecipients = { offline: false, ask: google, voice: voiceRecipient(), photo: photoRecipient(), decision: { openrouter: "google/gemini-2.5-flash-lite", cloudflare: "@cf/x/y" } };

/** A panel in miniature: stored choices, a signal log and the notice on screen. */
function rig(start: ConsentMap = {}, opts: { saveFails?: boolean } = {}) {
  const state = { consent: start, patch: {} as KeepLocalPatch, notices: [] as Array<NoticeRequest | null>, signal: [] as string[] };
  const out = createOutboundController({
    consent: () => state.consent,
    save: async (next, also) => {
      if (opts.saveFails) return false;
      state.consent = next;
      state.patch = { ...state.patch, ...also };
      return true;
    },
    fetchRecipients: async () => recipients,
    signal: {
      begin: (id, kind, names) => state.signal.push(`begin ${kind} ${names.join("+")}`),
      end: (id, o) => state.signal.push(o?.cancel ? "cancel" : "end"),
    },
    onNotice: (head) => state.notices.push(head),
  });
  /** What the panel does for a cloud question: ask first, send only on a yes. */
  const question = async (send: (headers: Record<string, string>) => Promise<string>) => {
    const decision = await out.allow("ask", google);
    if (decision !== "granted") return decision;
    return out.sending("ask", google, send);
  };
  return { out, state, question };
}

describe("first send: the notice decides, and a no sends nothing", () => {
  it("Keep it on this PC: the send function is never called, the signal never shows, the feature moves to this PC", async () => {
    const { out, state, question } = rig();
    const send = vi.fn(async () => "answer");
    const asked = question(send);
    expect(state.notices).toEqual([{ kind: "ask", recipient: google }]);
    await out.decide("declined");
    expect(await asked).toBe("declined");
    expect(send).not.toHaveBeenCalled();
    expect(state.signal).toEqual([]);
    expect(state.consent["ask:openrouter/google"].state).toBe("declined");
    expect(state.patch).toEqual({ provider: "local" });
    expect(state.notices.at(-1)).toBeNull();
  });

  it("closing the notice without choosing sends nothing and stores nothing", async () => {
    const { out, state, question } = rig();
    const send = vi.fn(async () => "answer");
    const asked = question(send);
    await out.decide("dismissed");
    expect(await asked).toBe("dismissed");
    expect(send).not.toHaveBeenCalled();
    expect(state.signal).toEqual([]);
    expect(state.consent).toEqual({});
  });

  it("dropping the question while the notice waits sends nothing", async () => {
    const { out, state, question } = rig();
    const send = vi.fn(async () => "answer");
    const asked = question(send);
    out.dismissAll();
    expect(await asked).toBe("dismissed");
    expect(send).not.toHaveBeenCalled();
    expect(state.consent).toEqual({});
  });

  it("Send: stores the yes, then sends with the consent header while the signal is on", async () => {
    const { out, state, question } = rig();
    const send = vi.fn(async (headers: Record<string, string>) => {
      expect(state.signal).toEqual(["begin ask OpenRouter+Google"]);
      return headers[CONSENT_HEADER];
    });
    const asked = question(send);
    await out.decide("granted");
    expect(await asked).toBe("ask:openrouter/google");
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.signal).toEqual(["begin ask OpenRouter+Google", "end"]);
    expect(state.consent["ask:openrouter/google"].state).toBe("granted");
    expect(state.patch).toEqual({});
  });

  it("a yes that could not be stored is not a yes", async () => {
    const { out, state, question } = rig({}, { saveFails: true });
    const send = vi.fn(async () => "answer");
    const asked = question(send);
    await out.decide("granted");
    expect(await asked).toBe("dismissed");
    expect(send).not.toHaveBeenCalled();
    expect(state.signal).toEqual([]);
  });

  it("the second question to the same recipient sends without a notice, and still shows the signal", async () => {
    const { state, question } = rig(withConsent({}, "ask", google, "granted"));
    expect(await question(async () => "answer")).toBe("answer");
    expect(state.notices).toEqual([]);
    expect(state.signal).toEqual(["begin ask OpenRouter+Google", "end"]);
  });

  it("a yes for Google does not cover another maker: the notice comes back", async () => {
    const { out, state } = rig(withConsent({}, "ask", google, "granted"));
    const openai = askRecipient("openai/gpt-4o-mini");
    const asked = out.allow("ask", openai);
    expect(state.notices).toEqual([{ kind: "ask", recipient: openai }]);
    await out.decide("declined");
    expect(await asked).toBe("declined");
  });
});

describe("sending: the only way out", () => {
  it("refuses without a stored yes, before calling anything", async () => {
    const { out, state } = rig();
    const send = vi.fn(async () => "answer");
    await expect(out.sending("ask", google, send)).rejects.toBeInstanceOf(NoConsentError);
    await expect(out.sending("voice", voiceRecipient(), send)).rejects.toBeInstanceOf(NoConsentError);
    expect(send).not.toHaveBeenCalled();
    expect(state.signal).toEqual([]);
  });

  it("refuses after the yes was withdrawn", async () => {
    const { out, state } = rig(withConsent({}, "voice", voiceRecipient(), "granted"));
    await out.sending("voice", voiceRecipient(), async () => "spoken");
    await out.forget("voice:elevenlabs");
    expect(state.consent).toEqual({});
    await expect(out.sending("voice", voiceRecipient(), async () => "spoken")).rejects.toBeInstanceOf(NoConsentError);
    expect(state.signal).toEqual(["begin voice ElevenLabs", "end"]);
  });

  it("turns the signal off when the request fails", async () => {
    const { out, state } = rig(withConsent({}, "ask", google, "granted"));
    await expect(out.sending("ask", google, async () => { throw new Error("network"); })).rejects.toThrow("network");
    expect(state.signal).toEqual(["begin ask OpenRouter+Google", "end"]);
  });

  it("drops the signal at once when the server answered on this PC", async () => {
    const { out, state } = rig(withConsent({}, "ask", google, "granted"));
    await out.sending("ask", google, async (_headers, quiet) => { quiet(); });
    expect(state.signal).toEqual(["begin ask OpenRouter+Google", "cancel"]);
  });
});

describe("the optional picture and the stored choices", () => {
  it("a no to pictures stays a no without asking again", async () => {
    const { out, state } = rig(withConsent({}, "photo", photoRecipient(), "declined"));
    expect(await out.allow("photo", photoRecipient())).toBe("declined");
    expect(state.notices).toEqual([]);
  });

  it("two answers given one after the other are both kept", async () => {
    const { out, state } = rig();
    const first = out.allow("ask", google);
    const second = out.allow("voice", voiceRecipient());
    await out.decide("granted");
    await out.decide("declined");
    expect([await first, await second]).toEqual(["granted", "declined"]);
    expect(Object.keys(state.consent).sort()).toEqual(["ask:openrouter/google", "voice:elevenlabs"]);
    expect(state.patch).toEqual({ voice: "system" });
  });

  it("names the recipients from the server, and keeps the last known ones when it cannot be reached", async () => {
    let fail = false;
    const out = createOutboundController({
      consent: () => ({}),
      save: async () => true,
      fetchRecipients: async () => { if (fail) throw new Error("down"); return recipients; },
      onNotice: () => {},
    });
    expect((await out.recipients())?.ask).toEqual(google);
    fail = true;
    expect((await out.recipients())?.ask).toEqual(google);
    const blind = createOutboundController({ consent: () => ({}), save: async () => true, fetchRecipients: async () => null, onNotice: () => {} });
    expect(await blind.recipients()).toBeNull();
  });
});
