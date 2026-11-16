import { afterEach, describe, expect, it, vi } from "vitest";
import { anonymizeRequest, restore } from "./guard";

// Stub only the Rizzo-PII sidecar (external HTTP server): it numbers placeholders per /analyze call, from 1.
const RIZZO: Record<string, { anonymized: string; mapping: Record<string, string> }> = {
  "Anna Rossi opens": { anonymized: "[FULLNAME_1] opens", mapping: { FULLNAME_1: "Anna Rossi" } },
  "Bruno Neri meets Carla Bianchi": {
    anonymized: "[FULLNAME_1] meets [FULLNAME_2]",
    mapping: { FULLNAME_1: "Bruno Neri", FULLNAME_2: "Carla Bianchi" },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("anonymizeRequest with Rizzo-PII: renumbering across texts of one request", () => {
  it("keeps two different people from a later text as two distinct placeholders", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) return new Response("ok", { status: 200 });
      const { text } = JSON.parse(String(init?.body));
      const r = RIZZO[text] ?? { anonymized: text, mapping: {} };
      return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const { req, map, layers } = await anonymizeRequest(
      { transcript: "Anna Rossi opens", sectionTitle: "Bruno Neri meets Carla Bianchi", bullets: [] },
      "on",
    );
    expect(layers).toContain("rizzo");
    expect(req.transcript).toBe("[FULLNAME_1] opens");
    const [a, b] = req.sectionTitle.split(" meets ");
    expect(a).not.toBe(b);
    expect(restore(req.sectionTitle, map)).toBe("Bruno Neri meets Carla Bianchi");
  });
});
