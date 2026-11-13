import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LANGS } from "@filow/core";
import { okfText } from "@/lib/buddy/text";
import { OKFILOW_SETUP_ROUTE } from "@/lib/buddy/openAsk";
import { cameForSetup } from "./OkFilowSettings";

// The main window's OK Filow button, pressed while OK Filow is off, opens this section instead of the
// panel: it says why in one line and puts the keyboard on the switch. The section loads its status
// after mount, so what it draws is read from the source; the look is checked in a hidden instance.
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const src = fs.readFileSync(path.join(here, "OkFilowSettings.tsx"), "utf8");

describe("OK Filow's section in Settings, opened by the OK Filow button", () => {
  it("knows it was opened for setup only from the button's address", () => {
    expect(cameForSetup(new URL(OKFILOW_SETUP_ROUTE, "http://127.0.0.1").search)).toBe(true);
    expect(cameForSetup("")).toBe(false);
    expect(cameForSetup("?okfilow=on")).toBe(false);
    expect(cameForSetup("?auto=x")).toBe(false);
  });

  it("is the anchor the address names, says why in one line while OK Filow is off, and focuses the switch", () => {
    expect(OKFILOW_SETUP_ROUTE.endsWith("#okfilow")).toBe(true);
    expect(src).toContain('<section className="strip" id="okfilow" aria-label="OK Filow">');
    expect(src).toContain('{setup && !s.enabled && <p className="okf-setup-off" role="status" data-testid="okf-setup-off">{t("setupOff")}</p>}');
    expect(src).toContain('ref={k === "enabled" ? onSwitch : undefined}');
    expect(src).toContain("onSwitch.current?.focus();");
    // the line comes before the switch it talks about
    expect(src.indexOf('t("setupOff")')).toBeLessThan(src.indexOf('{toggle("enabled")}'));
  });

  it("has the line in all five languages, each one sentence pair naming OK Filow", () => {
    const lines = LANGS.map((lang) => okfText(lang)("setupOff"));
    expect(new Set(lines).size).toBe(5);
    for (const line of lines) {
      expect(line).toContain("OK Filow");
      expect(line).not.toBe("setupOff");
      expect(line).not.toContain("\u2014");
      expect(line.split("\n")).toHaveLength(1);
    }
  });
});
