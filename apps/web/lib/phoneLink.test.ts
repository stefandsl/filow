import { describe, expect, it } from "vitest";
import { phoneLink, phoneTargets, type LoadedTargets } from "./phoneLink";
import type { RemoteStatus } from "./sessionUrl";

const LAN = "http://192.168.1.20:4747";
const RELAY = "http://192.168.1.20:4748";
const PUB = "https://calm-river-one.trycloudflare.com";
const PUB_RELAY = "https://slow-moon-two.trycloudflare.com";

/** A page loaded before the public link came up (the normal start). */
const lanLoad: LoadedTargets = { origin: LAN, relay: RELAY, anyNetwork: false, lanOrigin: LAN, engineRelay: RELAY };
/** A page loaded while the link was already up (a manual reload). */
const publicLoad: LoadedTargets = { origin: PUB, relay: PUB_RELAY, anyNetwork: true, lanOrigin: LAN, engineRelay: RELAY };
const status = (s: Partial<RemoteStatus>): RemoteStatus => ({ state: "off", url: "", error: "", ...s });

describe("phone targets follow the public link without a reload", () => {
  it("with no status yet, the page's own values stand", () => {
    expect(phoneTargets(lanLoad, null)).toEqual({ origin: LAN, relay: RELAY, anyNetwork: false });
    expect(phoneTargets(publicLoad, null)).toEqual({ origin: PUB, relay: PUB_RELAY, anyNetwork: true });
  });

  it("when the link comes up, both the page and the relay become public", () => {
    expect(phoneTargets(lanLoad, status({ state: "on", url: PUB, session: PUB_RELAY }))).toEqual({ origin: PUB, relay: PUB_RELAY, anyNetwork: true });
  });

  it("while it is connecting, downloading or failed, the phone stays on this network", () => {
    for (const state of ["connecting", "downloading", "error", "off"] as const) {
      expect(phoneTargets(lanLoad, status({ state })), state).toEqual({ origin: LAN, relay: RELAY, anyNetwork: false });
    }
  });

  it("when the link goes away after the page loaded with it, the QR falls back to this network", () => {
    expect(phoneTargets(publicLoad, status({ state: "off" }))).toEqual({ origin: LAN, relay: RELAY, anyNetwork: false });
    expect(phoneTargets(publicLoad, status({ state: "error", error: "tunnel lost" }))).toEqual({ origin: LAN, relay: RELAY, anyNetwork: false });
  });

  it("'on' without an address is not a public link", () => {
    expect(phoneTargets(lanLoad, status({ state: "on", url: "" })).anyNetwork).toBe(false);
  });

  it("a shell that sends no relay address keeps the one the page was loaded with", () => {
    expect(phoneTargets(publicLoad, status({ state: "on", url: PUB }))).toEqual({ origin: PUB, relay: PUB_RELAY, anyNetwork: true });
  });
});

describe("the link in the QR", () => {
  it("names the relay when it is on another origin", () => {
    expect(phoneLink("123456", { origin: PUB, relay: PUB_RELAY })).toBe(`${PUB}/mirror?code=123456&server=${encodeURIComponent(PUB_RELAY)}`);
    expect(phoneLink("123456", { origin: LAN, relay: RELAY })).toBe(`${LAN}/mirror?code=123456&server=${encodeURIComponent(RELAY)}`);
  });
  it("is the bare mirror page when page and relay share an origin (hosted mode)", () => {
    expect(phoneLink("123456", { origin: "https://app.example.org", relay: "https://app.example.org" })).toBe("https://app.example.org/mirror?code=123456");
  });
});
