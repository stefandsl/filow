import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateThresholdsFor, SETUP_PROFILES, setupChoices } from "@filow/core";
import { readFileSync } from "node:fs";
import { chooseSpeechLang, getGateMode, getSetupPreference, getSpeechLang, getStartMode, migrateGateMode, migrateStartMode, setGateMode, setSetupPreference, setStartMode, speechLangFor, syncSpeechLang } from "./prefs";

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

// Easy settings: a new profile starts takes on this PC without the Cloud / Local question; a profile
// that was used before keeps exactly what it had, also when what it had was never written down.
describe("the start mode", () => {
  it("a new profile is on Auto and stores nothing", () => {
    expect(getStartMode()).toBe("auto");
    expect(store.getItem("prefs:startMode")).toBeNull();
    // still Auto after the profile wrote its first settings (the check ran once)
    store.setItem("prefs:micDeviceId", "abc");
    store.setItem("okfilow.history.v1", "[]");
    expect(getStartMode()).toBe("auto");
  });

  it("a stored choice is untouched, whatever else the profile holds", () => {
    for (const v of ["ask", "auto", "cloud", "local"] as const) {
      use({ "prefs:startMode": v });
      expect(getStartMode()).toBe(v);
      expect(store.getItem("prefs:startMode")).toBe(v);
    }
  });

  // Before, nothing stored meant "ask" (the key was removed for it): such a user saw the dialog at every take.
  it.each([["prefs:micDeviceId", "abc"], ["prefs:speechLang", "it"], ["okfilow.history.v1", "[]"], ["prefs:gateMigrated", "1"], ["prefs:gate", "off"], ["prefs:setup", "lite"], ["mirror:lastCode", "1234"]])("a profile used before (%s) with nothing stored keeps the question", (key, value) => {
    use({ [key]: value });
    expect(getStartMode()).toBe("ask");
    expect(store.getItem("prefs:startMode")).toBe("ask");
    expect(getStartMode()).toBe("ask");
  });

  it("the interface language and theme mirrors do not make a profile a used one", () => {
    use({ "prefs:lang": "it", "prefs:theme": "dark" });
    expect(getStartMode()).toBe("auto");
  });

  it("a new profile stays new whichever setting is read or written first", () => {
    expect(getGateMode()).toBe("on");
    expect(getStartMode()).toBe("auto");
    use();
    setGateMode("off");
    expect(getStartMode()).toBe("auto");
    use();
    setSetupPreference("lite");
    expect(getStartMode()).toBe("auto");
    use();
    migrateStartMode(store);
    store.setItem("prefs:screenMode", "off");
    expect(getStartMode()).toBe("auto");
  });

  // OK Filow's windows write their history without ever reading the start mode: the check must have run by then.
  it("a page that only loads the preferences has told new from used before it writes anything", async () => {
    vi.stubGlobal("window", { localStorage: store });
    vi.resetModules();
    const loaded = await import("./prefs");
    expect(store.getItem("prefs:startModeMigrated")).toBe("1");
    store.setItem("okfilow.history.v1", "[]");
    expect(loaded.getStartMode()).toBe("auto");
  });

  it("every choice is written down, also Ask every time, and survives a reload", () => {
    for (const v of ["ask", "cloud", "local", "auto"] as const) {
      setStartMode(v);
      expect(store.getItem("prefs:startMode")).toBe(v);
      expect(getStartMode()).toBe(v);
    }
    // a new profile that picks "Ask every time" before anything else keeps it
    use();
    setStartMode("ask");
    expect(getStartMode()).toBe("ask");
  });

  it("the gate's own rule for earlier installs is unchanged by it", () => {
    use({ "prefs:speechLang": "it" });
    expect(getStartMode()).toBe("ask");
    expect(getGateMode()).toBe("off");
    use();
    expect(getStartMode()).toBe("auto");
    expect(getGateMode()).toBe("on");
  });

  it("without storage the question stays", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(getStartMode()).toBe("ask");
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