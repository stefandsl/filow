import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSetup, t, type MachineInfo } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { StartModeDialog, localProvider, localReady } from "./Teleprompter";

const oldLaptop: MachineInfo = { ramGb: 8, cores: 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: 40 };
const rig: MachineInfo = { ramGb: 32, cores: 22, gpu: { kind: "discrete", vramGb: 8 }, freeDiskGb: 400 };
const base = { openrouterKey: false, sttKey: false, whisper: true, sherpa: true, clef: false, stt: { elevenlabs: false, openai: false } };

describe("local take readiness follows the setup", () => {
  it("an old laptop without Clef can start a local take: the matcher decides", () => {
    const r = { ...base, setup: resolveSetup("auto", oldLaptop) };
    expect(localProvider(r)).toBe("matcher");
    expect(localReady(r)).toBe(true);
    expect(localReady({ ...r, whisper: false })).toBe(false);
  });

  it("Best quality uses Clef when installed and the matcher until then; no setup keeps the old Clef rule", () => {
    expect(localProvider({ clef: true, setup: resolveSetup("auto", rig) })).toBe("clef-local");
    expect(localProvider({ clef: false, setup: resolveSetup("auto", rig) })).toBe("matcher");
    expect(localReady({ whisper: true, clef: false, setup: null })).toBe(false);
  });

  it("the start dialog names the setup, offers to change it, and enables Local without Clef", () => {
    const html = renderToStaticMarkup(
      <LangProvider lang="en">
        <StartModeDialog readiness={{ ...base, setup: resolveSetup("auto", oldLaptop) }} onPick={() => {}} onCancel={() => {}} />
      </LangProvider>,
    );
    expect(html).toContain("Setup: Fast on any computer");
    expect(html).toContain('href="/settings/local#setup"');
    expect(html).toContain("Point checking on this computer");
    expect(html).toContain("Chosen for this computer: Fast on any computer.");
    // both Start buttons: Cloud is disabled (no keys), Local is enabled
    const buttons = [...html.matchAll(/<button[^>]*>[^<]*Start[^<]*·[^<]*(Cloud|Local)/g)].map((m) => [m[1], /disabled/.test(m[0])]);
    expect(buttons).toContainEqual(["Local", false]);
    expect(buttons).toContainEqual(["Cloud", true]);
  });

  // Review T2 finding 1: with no speech model the dialog says so plainly, and Auto never starts the cloud by itself
  it("without the speech model the dialog says the voice would have to go online, and offers no Auto start", () => {
    const html = renderToStaticMarkup(
      <LangProvider lang="en">
        <StartModeDialog readiness={{ ...base, whisper: false, sherpa: false, openrouterKey: true, sttKey: true, setup: resolveSetup("auto", oldLaptop) }} onPick={() => {}} onCancel={() => {}} />
      </LangProvider>,
    );
    expect(html.replace(/&#x27;/g, "'")).toContain(t("start.noLocalSpeech", "en"));
    expect(html).not.toContain("Speech model on this PC (streaming");
    // the cloud is its own button, never the automatic pick (before: "Filow would start in Cloud mode")
    expect(html).not.toContain(t("start.autoTitle", "en"));
  });
});
