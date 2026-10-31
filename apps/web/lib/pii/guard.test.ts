import { describe, expect, it } from "vitest";
import { anonymizeRequest, regexAnonymize, restore, type PiiMap } from "./guard";

describe("regexAnonymize", () => {
  it("replaces emails, IBANs, codice fiscale, phones and card numbers with stable placeholders", () => {
    const map: PiiMap = new Map();
    const text =
      "Scrivi a mario.rossi@example.com o chiama +39 333 123 4567. IBAN IT60X0542811101000000123456, CF RSSMRA85M01H501Q, carta 4111 1111 1111 1111.";
    const out = regexAnonymize(text, map);
    expect(out).toContain("[EMAIL_1]");
    expect(out).toContain("[IBAN_1]");
    expect(out).toContain("[CODICE_FISCALE_1]");
    expect(out).toContain("[CARD_1]");
    expect(out).toContain("[PHONE_1]");
    expect(out).not.toContain("example.com");
    expect(map.get("[EMAIL_1]")).toBe("mario.rossi@example.com");
    // same value again -> same placeholder, no new entry
    const again = regexAnonymize("ancora mario.rossi@example.com", map);
    expect(again).toBe("ancora [EMAIL_1]");
    expect([...map.keys()].filter((k) => k.startsWith("[EMAIL_")).length).toBe(1);
  });

  it("leaves non-Luhn digit runs and short numbers alone", () => {
    const map: PiiMap = new Map();
    expect(regexAnonymize("order 1234 5678 9012 3450 and year 2026", map)).toBe("order 1234 5678 9012 3450 and year 2026");
  });

  it("restore puts the originals back", () => {
    const map: PiiMap = new Map([["[EMAIL_1]", "a@b.co"]]);
    expect(restore("write to [EMAIL_1] twice [EMAIL_1]", map)).toBe("write to a@b.co twice a@b.co");
  });
});

describe("anonymizeRequest", () => {
  it("guards every text field with one shared map and reports layers (regex only when no sidecar)", async () => {
    const { req, map, layers } = await anonymizeRequest(
      {
        transcript: "call me at +39 333 123 4567",
        bullets: [{ id: "a", text: "mention a@b.co" }],
        sectionTitle: "Intro",
        covered: ["email a@b.co"],
        upcoming: ["IBAN IT60X0542811101000000123456"],
        onScreen: ["+39 333 123 4567"],
      },
      "on",
    );
    expect(layers).toEqual(["regex"]);
    expect(req.transcript).toBe("call me at [PHONE_1]");
    expect(req.bullets[0]).toEqual({ id: "a", text: "mention [EMAIL_1]" });
    expect(req.covered).toEqual(["email [EMAIL_1]"]);
    expect(req.onScreen).toEqual(["[PHONE_1]"]);
    expect(map.size).toBe(3);
  });

  it("mode off returns the request untouched", async () => {
    const r = { transcript: "a@b.co", bullets: [], sectionTitle: "s" };
    const { req, layers } = await anonymizeRequest(r, "off");
    expect(req).toBe(r);
    expect(layers).toEqual([]);
  });

  it("strict mode throws when the sidecar is unreachable", async () => {
    process.env.PII_SERVER_URL = "http://127.0.0.1:1";
    await expect(anonymizeRequest({ transcript: "x", bullets: [], sectionTitle: "s" }, "strict")).rejects.toThrow(/strict/);
  });
});
