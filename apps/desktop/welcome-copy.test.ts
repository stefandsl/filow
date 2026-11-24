import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DICTIONARIES, LANGS, t } from "../../packages/core/src/index";
import { iconPaths } from "../web/components/icons";

const SHIPPED_BRAND_FEATURES = [
  { key: "welcome.featurePoints", icon: "check" },
  { key: "welcome.featureSlides", icon: "slides" },
  { key: "welcome.featurePhone", icon: "phone" },
  { key: "welcome.featureBuddy", icon: "ask" },
  { key: "welcome.featureWhiteboard", icon: "board" },
  { key: "welcome.featureDictation", icon: "mic" },
  { key: "welcome.featureDaily", icon: "calendar" },
] as const;

const SHIPPED_GUIDE_FEATURES = [
  { key: "welcome.guidePoints", icon: "check" },
  { key: "welcome.guideSlides", icon: "slides" },
  { key: "welcome.guidePhone", icon: "phone" },
  { key: "welcome.guideBuddy", icon: "ask" },
  { key: "welcome.guideWhiteboard", icon: "board" },
  { key: "welcome.guideDictation", icon: "mic" },
  { key: "welcome.guideDaily", icon: "calendar" },
] as const;

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

describe("onboarding shows every shipped feature and never advertises held ones", () => {
  const html = readFileSync(new URL("./welcome.html", import.meta.url), "utf8");

  it("lists all seven shipped features in the brand panel with shared icons", () => {
    const brandBlock = html.match(/<ul class="features"[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(brandBlock).toBeTruthy();
    for (const { key, icon } of SHIPPED_BRAND_FEATURES) {
      expect(icon in iconPaths, `icon "${icon}" exists in iconPaths`).toBe(true);
      expect(brandBlock, `brand feature ${key}`).toContain(`data-icon="${icon}"`);
      expect(brandBlock, `brand feature ${key}`).toContain(`data-i18n="${key}"`);
    }
  });

  it("explains how to start each shipped feature in the Quick start step", () => {
    const introBlock = html.match(/<section class="step" data-step="intro"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(introBlock).toBeTruthy();
    for (const { key, icon } of SHIPPED_GUIDE_FEATURES) {
      expect(icon in iconPaths, `icon "${icon}" exists in iconPaths`).toBe(true);
      expect(introBlock, `quick start guide ${key}`).toContain(`data-icon="${icon}"`);
      expect(
        introBlock.includes(`data-i18n="${key}"`) || introBlock.includes(`data-guide="${key}"`),
        `quick start guide ${key}`,
      ).toBe(true);
    }
  });

  it("ships natural, non-empty, em-dash-free copy in all five languages without held capabilities", () => {
    const allKeys = [
      ...SHIPPED_BRAND_FEATURES.map(f => f.key),
      ...SHIPPED_GUIDE_FEATURES.map(f => f.key),
      "welcome.featuresLabel",
      "welcome.guideList",
    ];
    for (const lang of LANGS) {
      const dict = DICTIONARIES[lang] as Record<string, string | undefined>;
      for (const key of allKeys) {
        const value = dict[key];
        expect(value && value.trim().length > 0, `${lang} missing ${key}`).toBe(true);
        expect(value, `${lang} ${key} em dash`).not.toContain("\u2014");
        expect(value, `${lang} ${key} held capability`).not.toMatch(/live lesson generation|generazione.*lezioni.*dal vivo|wake word|parola di attivazione|Microsoft To Do/i);
      }
    }
  });
});
