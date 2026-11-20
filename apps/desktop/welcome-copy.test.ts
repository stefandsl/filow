import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "../../packages/core/src/index";

// The setup card distinguishes LAN pairing from the optional Cloudflare link.
describe("setup card copy is true", () => {
  const html = readFileSync(new URL("./welcome.html", import.meta.url), "utf8");
  for (const lang of ["en", "it"] as const) {
    it(`${lang}: no blanket "no cloud" promise, and it names the phone link's carrier and the cloud AI`, () => {
      const card = `${t("welcome.setupPrivate", lang)} ${t("welcome.setupOnline", lang)}`;
      expect(card).not.toMatch(/no cloud|nessun cloud|stay here|restano qui|only two|solo due/i);
      expect(card).toContain("Wi-Fi");
      expect(card).not.toMatch(/on by default|attivo di default/i);
      expect(card).toMatch(/Cloudflare/);
      expect(card).toMatch(/update|aggiornament/i);
      expect(card).toMatch(/\bAI\b.*(key|chiave)/);
    });
  }
  it("the card shows both lines", () => {
    expect(html).toContain('data-i18n="welcome.setupPrivate"');
    expect(html).toContain('data-i18n="welcome.setupOnline"');
  });
  it("identifies an opening microphone before capture starts", () => {
    expect(html).toMatch(/id="mic-card"[^>]*data-state="opening"/);
    const source = readFileSync(new URL("./welcome.ts", import.meta.url), "utf8");
    expect(source).toContain('"welcome.micOpening"');
  });
});
