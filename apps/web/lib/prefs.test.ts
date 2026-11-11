import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateThresholdsFor, SETUP_PROFILES, setupChoices } from "@filow/core";
import { readFileSync } from "node:fs";
import { chooseSpeechLang, getGateMode, getSetupPreference, getSpeechLang, migrateGateMode, setGateMode, setSetupPreference, speechLangFor, syncSpeechLang } from "./prefs";

/** A localStorage that lives in this test only. */
function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    dump: () => Object.fromEntries(m),
  };
}

let store: ReturnType<typeof memoryStorage>;
const use = (init: Record<string, string> = {}) => {
  store = memoryStorage(init);
  vi.stubGlobal("localStorage", store);
};
beforeEach(() => use());
afterEach(() => vi.unstubAllGlobals());

// Review T2 finding 8: the remembered setup choice
describe("the setup choice is remembered", () => {
  it("auto until the user picks; a pick survives a reload; auto again clears it", () => {
    expect(getSetupPreference()).toBe("auto");
    setSetupPreference("lite");
    expect(store.getItem("prefs:setup")).toBe("lite");
    expect(getSetupPreference()).toBe("lite");
    setSetupPreference("auto");
    expect(store.getItem("prefs:setup")).toBeNull();
    use({ "prefs:setup": "bogus" });
    expect(getSetupPreference()).toBe("auto");
  });
});

// Review T2 findings 5 and 8: the gate default, and a user's "off" from before the setup profiles
describe("the pre-filter (gate)", () => {
  it("is on by default on a new install, and remembers off and on", () => {
    expect(getGateMode()).toBe("on");
    setGateMode("off");
    expect(getGateMode()).toBe("off");
    setGateMode("on");
    expect(getGateMode()).toBe("on");
  });

  it("stays off on an install used before P3, where nothing stored meant off", () => {
    use({ "prefs:startMode": "local", "prefs:speechLang": "it" });
    expect(getGateMode()).toBe("off");
    expect(store.getItem("prefs:gate")).toBe("off");
    // the user turns it on later: on it stays, the migration does not run twice
    setGateMode("on");
    expect(getGateMode()).toBe("on");
  });

  it("an earlier install that had it on keeps it on", () => {
    use({ "prefs:gate": "on", "prefs:startMode": "local" });
    expect(getGateMode()).toBe("on");
  });

  it("runs once: a new install that later writes other settings keeps the gate on", () => {
    expect(getGateMode()).toBe("on");
    store.setItem("prefs:startMode", "local");
    expect(getGateMode()).toBe("on");
    const s = memoryStorage({ "prefs:gateMigrated": "1", "prefs:screenMode": "fast" });
    migrateGateMode(s);
    expect(s.getItem("prefs:gate")).toBeNull();
  });

  it("its width follows the take's decision provider, which is what each setup describes", () => {
    for (const p of SETUP_PROFILES) {
      const c = setupChoices(p, { ramGb: 32, cores: 16, gpu: { kind: "discrete", vramGb: 8 }, freeDiskGb: 500 });
      expect(gateThresholdsFor(c.decision.provider).narrow !== false, p).toBe(c.gate.narrow);
    }
  });
});

// T3, DUP3: the spoken language has one store. In the desktop app that is the shell (settings.json);
// localStorage only mirrors it, so a stale mirror must never overwrite what the shell holds.
describe("spoken language", () => {
  it("reads the shell's value into the page at start instead of pushing the page's copy", async () => {
    use({ "prefs:speechLang": "it" }); // a stale mirror
    const setLanguage = vi.fn(async (language: string) => ({ language }));
    const { lang, status } = await syncSpeechLang({ status: async () => ({ language: "ja" }), setLanguage });
    expect(lang).toBe("ja");
    expect(status).toEqual({ language: "ja" });
    expect(getSpeechLang()).toBe("ja");
    expect(setLanguage).not.toHaveBeenCalled();
  });
  it("keeps a choice made while the shell was still answering", async () => {
    let answer: (s: { language: string }) => void = () => {};
    const pending = syncSpeechLang({ status: () => new Promise<{ language: string }>((r) => { answer = r; }) });
    await chooseSpeechLang("ja", null); // the user picks before the shell's (older) answer arrives
    answer({ language: "it" });
    expect((await pending).lang).toBe("ja");
    expect(getSpeechLang()).toBe("ja");
  });
  it("keeps it even when the choice is the value the page showed before (picked away and back)", async () => {
    use({ "prefs:speechLang": "it" });
    let answer: (s: { language: string }) => void = () => {};
    const pending = syncSpeechLang({ status: () => new Promise<{ language: string }>((r) => { answer = r; }) });
    await chooseSpeechLang("ro", null);
    await chooseSpeechLang("it", null);
    answer({ language: "ja" }); // what the shell held when it was asked
    expect((await pending).lang).toBe("it");
    expect(getSpeechLang()).toBe("it");
  });
  it("keeps a choice of Auto made while the shell was still answering", async () => {
    use({});
    let answer: (s: { language: string }) => void = () => {};
    const pending = syncSpeechLang({ status: () => new Promise<{ language: string }>((r) => { answer = r; }) });
    await chooseSpeechLang("auto", null);
    answer({ language: "ru" });
    expect((await pending).lang).toBe("auto");
  });
  it("writes a choice to the shell and to the mirror, and works without a shell", async () => {
    const setLanguage = vi.fn(async (language: string) => ({ language }));
    expect(await chooseSpeechLang("ro", { status: async () => ({}), setLanguage })).toEqual({ language: "ro" });
    expect(setLanguage).toHaveBeenCalledWith("ro");
    expect(getSpeechLang()).toBe("ro");
    expect(await chooseSpeechLang("ru", null)).toBeNull();
    expect((await syncSpeechLang(null)).lang).toBe("ru");
  });
  it("hands a backend the set language, and the interface language only to one that cannot detect", () => {
    expect(speechLangFor("it", true)).toBe("auto");
    expect(speechLangFor("it", false)).toBe("it");
    use({ "prefs:speechLang": "ja" });
    expect(speechLangFor("it", false)).toBe("ja");
  });
  it("sends OK Filow's questions with the spoken language, never a fixed auto", () => {
    const panel = readFileSync(new URL("../app/okfilow/panel/page.tsx", import.meta.url), "utf8");
    expect(panel.match(/language: getSpeechLang\(\)/g)).toHaveLength(2);
    expect(panel).not.toMatch(/language: "auto"/);
  });
});