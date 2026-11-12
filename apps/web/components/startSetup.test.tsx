import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSetup, t, type MachineInfo } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { StartModeDialog, localProvider, localReady, modeAfterPick, startStep } from "./Teleprompter";

const oldLaptop: MachineInfo = { ramGb: 8, cores: 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: 40 };
const rig: MachineInfo = { ramGb: 32, cores: 22, gpu: { kind: "discrete", vramGb: 8 }, freeDiskGb: 400 };
const base = { openrouterKey: false, sttKey: false, whisper: true, sherpa: true, clef: false, stt: { elevenlabs: false, openai: false } };

// Easy settings: a new profile is on Auto. Start then runs the take on this PC, or shows the dialog
// that names what is missing; it never starts an online take by itself.
describe("what Start does", () => {
  const ready = { ...base, setup: resolveSetup("auto", oldLaptop) };
  const online = { ...ready, openrouterKey: true, sttKey: true };

  it("Auto with a local plan starts on this PC without the dialog", () => {
    expect(startStep("auto", ready, "local")).toBe("plan");
    // the router did not answer, the local engines are there: still local, no dialog
    expect(startStep("auto", ready, null)).toBe("local");
  });

  it("Auto never starts an online take, also with every key set and an online plan", () => {
    expect(startStep("auto", online, "cloud")).toBe("local");
    const noLocal = { ...online, whisper: false, sherpa: false };
    expect(startStep("auto", noLocal, "cloud")).toBe("dialog");
    expect(startStep("auto", noLocal, null)).toBe("dialog");
    for (const planned of ["local", "cloud", null] as const) for (const r of [ready, online, noLocal]) expect(startStep("auto", r, planned)).not.toBe("cloud");
  });

  it("Ask every time always shows the dialog; a remembered choice starts when ready and asks when not", () => {
    expect(startStep("ask", online, "local")).toBe("dialog");
    expect(startStep("cloud", online, null)).toBe("cloud");
    expect(startStep("cloud", ready, null)).toBe("dialog");
    expect(startStep("local", ready, null)).toBe("local");
    expect(startStep("local", { ...ready, whisper: false }, null)).toBe("dialog");
  });

  it("a pick in the dialog: remembered when asked to; otherwise the question returns, and Auto stays Auto", () => {
    expect(modeAfterPick("ask", "local", true)).toBe("local");
    expect(modeAfterPick("ask", "cloud", true)).toBe("cloud");
    expect(modeAfterPick("ask", "local", true, true)).toBe("auto");
    expect(modeAfterPick("ask", "cloud", false)).toBe("ask");
    expect(modeAfterPick("cloud", "local", false)).toBe("ask");
    expect(modeAfterPick("local", "cloud", false)).toBe("ask");
    expect(modeAfterPick("auto", "cloud", false)).toBe("auto");
    expect(modeAfterPick("auto", "cloud", true)).toBe("cloud");
  });
});

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
