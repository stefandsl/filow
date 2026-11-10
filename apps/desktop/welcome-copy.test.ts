import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "../../packages/core/src/index";

// Review T3 finding 1: the setup card promised "no cloud" while the public link is on by default and a
// cloud AI can be added. The card must say what runs here and name what uses the internet.
describe("setup card copy is true", () => {
  const html = readFileSync(new URL("./welcome.html", import.meta.url), "utf8");
  for (const lang of ["en", "it"] as const) {
    it(`${lang}: no blanket "no cloud" promise, and it names the phone link's carrier and the cloud AI`, () => {
      const card = `${t("welcome.setupPrivate", lang)} ${t("welcome.setupOnline", lang)}`;
      expect(card).not.toMatch(/no cloud|nessun cloud|stay here|restano qui|only two|solo due/i);
      // Everything main.js sends out on a default install: downloads and update checks, the public link
      // (cloudflared, on by default), and a cloud AI that needs the user's own key.
      expect(card).toMatch(/Cloudflare/);
      expect(card).toMatch(/update|aggiornament/i);
      expect(card).toMatch(/\bAI\b.*(key|chiave)/);
    });
  }
  it("the card shows both lines", () => {
    expect(html).toContain('data-i18n="welcome.setupPrivate"');
    expect(html).toContain('data-i18n="welcome.setupOnline"');
  });
});
