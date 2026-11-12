import { describe, expect, it } from "vitest";
import { applyEasyPatch, EASY_CONTROLS, easyPatch, easyRead, easyRecommended, easyReset, easyView, type EasyCaps, type EasyControl, type EasyPatch, type EasySnapshot, type EasyState } from "./easy";
import { GPU_FIXTURES } from "./hardware.fixtures";
import { recommendProfile, type MachineInfo } from "./profile";

const machine = (ramGb: number, cores: number, gpu: MachineInfo["gpu"] = { kind: "none", vramGb: null }, freeDiskGb: number | null = 200): MachineInfo => ({ ramGb, cores, gpu, freeDiskGb });
const rtx = (vramGb: number) => ({ kind: "discrete" as const, vramGb });

/** What a fresh profile holds (okfilow.js DEFAULTS, dictation-core.js DEFAULTS, ui-preferences, prefs.ts on a new profile). */
const fresh = (): EasySnapshot => ({
  okFilow: { provider: "local", voice: "system", seeScreen: "auto" },
  dictation: { enabled: true, cleanup: true, punctuate: true, removeFillers: true },
  ui: { lang: "", runAtStartup: false },
  local: { setup: "auto", startMode: "auto", translateWhere: "local" },
  speechLanguage: "auto",
});
const NONE: EasyCaps = { online: { openrouter: false, freellm: false } };
const BOTH: EasyCaps = { online: { openrouter: true, freellm: true } };

/**
 * Named machines: the tiers and their edges. `pictures`: until the user chooses, a question takes
 * the screen with it there (the rule of apps/web/lib/buddy/sees.ts: off only where this PC answers
 * from the user's words alone; a PC with no helper at all keeps the default on).
 */
const TIERS: Array<{ label: string; m: MachineInfo; profile: string; pictures: boolean }> = [
  { label: "4 GB, 2 cores", m: machine(4, 2), profile: "lite", pictures: true },
  { label: "8 GB, 4 cores", m: machine(8, 4), profile: "lite", pictures: false },
  { label: "16 GB, 8 cores, no card", m: machine(16, 8), profile: "standard", pictures: true },
  { label: "16 GB with an 8 GB card", m: machine(16, 8, rtx(8)), profile: "advanced", pictures: true },
  { label: "32 GB with a 12 GB card", m: machine(32, 16, rtx(12)), profile: "advanced", pictures: true },
  { label: "Apple with 32 GB", m: machine(32, 10, { kind: "unified", vramGb: 32 }), profile: "advanced", pictures: true },
  { label: "32 GB with a 12 GB card, no room for the big download", m: machine(32, 16, rtx(12), 10),profile: "standard", pictures: true },
  { label: "16 GB laptop, disk too full for the screen helper", m: machine(16, 8, undefined, 3), profile: "standard", pictures: true },
];
/** The 11 real graphics cards of the shared fixtures, each in a 16 GB, 8 core PC. */
const CARDS = GPU_FIXTURES.map((f) => ({ label: f.label, m: machine(16, 8, { kind: f.want.kind as MachineInfo["gpu"]["kind"], vramGb: f.want.vramGb, ollama: f.want.ollama }) }));

const apply = (s: EasySnapshot, control: EasyControl, value: string, m: MachineInfo, caps = BOTH): EasySnapshot => {
  const r = easyPatch(control, value as never, s, m, caps);
  if (!r.ok) throw new Error(`${control}=${value} refused: ${r.needs}`);
  return applyEasyPatch(s, r.patch);
};
const laptop = machine(16, 8);

describe("what Filow chooses for a PC", () => {
  it("is the same on every tier, except the picture of the screen", () => {
    for (const { label, m, profile, pictures } of TIERS) {
      expect(recommendProfile(m).profile, label).toBe(profile);
      expect(easyRecommended(m), label).toEqual<EasyState>({ private: "on", screen: pictures ? "on" : "off", voice: "on", dictation: "on", tidy: "on", quality: "auto", language: "", startup: "off" });
    }
  });

  it("is what a fresh profile reads as, on every tier and every fixture card, with nothing to reset", () => {
    for (const { label, m } of [...TIERS, ...CARDS]) {
      expect(easyRead(fresh(), m), label).toEqual(easyRecommended(m));
      expect(easyReset(fresh(), m, NONE), label).toEqual({ patch: {}, changes: [] });
      expect(easyView(fresh(), m, NONE).changed, label).toEqual([]);
    }
  });

  it("keeps everything on the PC on every machine, also one too small to answer by itself", () => {
    const small = machine(4, 2);
    expect(easyRecommended(small).private).toBe("on");
    expect(easyView(fresh(), small, NONE).private.localAnswers).toBe(false);
    expect(easyView(fresh(), laptop, NONE).private.localAnswers).toBe(true);
  });

  it("follows the cards Ollama can use: an 8 GB card it cannot use gets no Best quality and counts as none", () => {
    const by = (label: string) => CARDS.find((c) => c.label.startsWith(label))!.m;
    expect(easyView(fresh(), by("RTX 3070"), NONE).quality.chosen).toBe("advanced");
    expect(easyView(fresh(), by("Intel Arc A750"), NONE).quality.chosen).toBe("standard");
    expect(easyView(fresh(), by("Radeon RX 7800 XT"), NONE).quality.chosen).toBe("advanced");
  });
});

describe("round trips", () => {
  const messy = (): EasySnapshot => ({
    okFilow: { provider: "cloud", voice: "cloud", seeScreen: "off" },
    dictation: { enabled: false, cleanup: false, punctuate: true, removeFillers: false },
    ui: { lang: "ja", runAtStartup: true },
    local: { setup: "standard", startMode: "cloud", translateWhere: "cloud" },
    speechLanguage: "ru",
  });

  it("reset from any state reads as recommended, never Custom, on every tier", () => {
    for (const { label, m } of TIERS) {
      const { patch, changes } = easyReset(messy(), m, BOTH);
      expect(changes, label).toEqual([...EASY_CONTROLS]);
      const after = applyEasyPatch(messy(), patch);
      expect(easyRead(after, m), label).toEqual(easyRecommended(m));
      expect(easyReset(after, m, BOTH).changes, label).toEqual([]);
      // the spoken language is not an Easy setting: reset leaves it
      expect(after.speechLanguage).toBe("ru");
    }
  });

  it("every option of every control reads back as that option", () => {
    const strong = machine(32, 16, rtx(12), 5);
    const options: Array<[EasyControl, string[], MachineInfo]> = [
      ["private", ["off", "on"], laptop], ["screen", ["off", "on"], laptop], ["voice", ["off", "on"], laptop], ["dictation", ["off", "on"], laptop],
      ["tidy", ["off", "on"], laptop], ["quality", ["faster", "auto"], laptop], ["language", ["it", "ru", "ro", "ja", "en", ""], laptop], ["startup", ["on", "off"], laptop],
      ["quality", ["best", "faster", "auto"], { ...strong, freeDiskGb: 200 }],
    ];
    for (const [control, values, m] of options) {
      let s = fresh();
      for (const v of values) {
        s = apply(s, control, v, m);
        expect(easyRead(s, m)[control], `${control}=${v}`).toBe(v);
      }
    }
  });

  it("a control that already reads as asked gets no write (a chosen natural voice is not put back to automatic)", () => {
    const s = { ...fresh(), okFilow: { ...fresh().okFilow, voice: "natural" as const }, local: { ...fresh().local, startMode: "local" as const } };
    for (const control of EASY_CONTROLS) expect(easyPatch(control, easyRead(s, laptop)[control] as never, s, laptop, BOTH), control).toEqual({ ok: true, patch: {} });
  });
});

describe("Custom: a detailed setting contradicts the control", () => {
  const cases: Array<[EasyControl, string, (s: EasySnapshot) => void]> = [
    ["private", "online voice", (s) => { s.okFilow.voice = "cloud"; }],
    ["private", "takes ask every time", (s) => { s.local.startMode = "ask"; }],
    ["private", "takes always online", (s) => { s.local.startMode = "cloud"; }],
    ["private", "translation online", (s) => { s.local.translateWhere = "cloud"; }],
    ["voice", "online voice", (s) => { s.okFilow.voice = "cloud"; }],
    ["tidy", "clean-up off only", (s) => { s.dictation.cleanup = false; }],
    ["tidy", "punctuation off only", (s) => { s.dictation.punctuate = false; }],
    ["tidy", "hesitation sounds kept only", (s) => { s.dictation.removeFillers = false; }],
    ["tidy", "only punctuation on", (s) => { s.dictation.cleanup = false; s.dictation.removeFillers = false; }],
    ["quality", "Balanced pinned", (s) => { s.local.setup = "standard"; }],
  ];
  it.each(cases)("%s: %s", (control, _what, change) => {
    const s = fresh();
    change(s);
    expect(easyRead(s, laptop)[control]).toBe("custom");
    // only that control leaves its value (the online voice shows on two controls)
    const others = EASY_CONTROLS.filter((c) => c !== control && easyRead(s, laptop)[c] !== easyRecommended(laptop)[c]);
    expect(others).toEqual(control === "private" && s.okFilow.voice === "cloud" ? ["voice"] : control === "voice" ? ["private"] : []);
    // touching the control leaves Custom
    const back = apply(s, control, easyRecommended(laptop)[control] as string, laptop);
    expect(easyRead(back, laptop)[control]).toBe(easyRecommended(laptop)[control]);
  });

  it("names what differs under Keep it on this PC", () => {
    const s = fresh();
    s.okFilow.voice = "cloud"; s.local.startMode = "ask"; s.local.translateWhere = "cloud";
    expect(easyView(s, laptop, NONE).private.differences).toEqual(["voice-online", "takes-ask", "translate-online"]);
    s.local.startMode = "cloud";
    expect(easyView(s, laptop, NONE).private.differences).toContain("takes-online");
    expect(easyView(fresh(), laptop, NONE).private.differences).toEqual([]);
  });

  it("the switches without a Custom state read on or off only", () => {
    for (const enabled of [true, false]) for (const runAtStartup of [true, false]) for (const seeScreen of ["auto", "on", "off"] as const) {
      const s = fresh();
      s.dictation.enabled = enabled; s.ui.runAtStartup = runAtStartup; s.okFilow.seeScreen = seeScreen;
      expect(easyRead(s, laptop)).toMatchObject({ dictation: enabled ? "on" : "off", startup: runAtStartup ? "on" : "off", screen: seeScreen === "off" ? "off" : "on" });
    }
  });
});

describe("Keep it on this PC", () => {
  const online = (s: EasySnapshot) => [s.okFilow.provider !== "local", s.okFilow.voice === "cloud", s.local.startMode === "cloud", s.local.translateWhere === "cloud"];

  it("on: no feature is left on an online service, from any starting point", () => {
    for (const provider of ["local", "cloud", "freellm"] as const) for (const voice of ["system", "natural", "cloud", "off"] as const)
      for (const startMode of ["ask", "auto", "cloud", "local"] as const) for (const translateWhere of ["local", "cloud"] as const) {
        const s: EasySnapshot = { ...fresh(), okFilow: { provider, voice, seeScreen: "auto" }, local: { setup: "auto", startMode, translateWhere } };
        const after = apply(s, "private", "on", laptop);
        expect(online(after), JSON.stringify(s)).toEqual([false, false, false, false]);
        expect(easyRead(after, laptop).private).toBe("on");
        // reading On is only possible with nothing online and no question at Start take
        if (easyRead(s, laptop).private === "on") expect([...online(s), s.local.startMode === "ask"]).toEqual([false, false, false, false, false]);
        // a voice that was not online, and a take mode already on this PC, are left as they were
        if (voice !== "cloud") expect(after.okFilow.voice).toBe(voice);
        if (startMode === "local") expect(after.local.startMode).toBe("local");
      }
  });

  it("on from an online voice puts the voice back on automatic", () => {
    const s = fresh();
    s.okFilow.voice = "cloud";
    expect(easyPatch("private", "on", s, laptop, NONE)).toEqual({ ok: true, patch: { okFilow: { voice: "system", voiceChosen: false } } });
    // where the natural voice was speaking before, it is the one put back
    expect(easyPatch("private", "on", s, laptop, { ...NONE, naturalVoice: true })).toEqual({ ok: true, patch: { okFilow: { voice: "natural", voiceChosen: false } } });
  });

  it("off writes only where answers come from: no consent, no take mode, no voice, no translation", () => {
    expect(easyPatch("private", "off", fresh(), laptop, BOTH)).toEqual({ ok: true, patch: { okFilow: { provider: "cloud" } } });
    expect(easyPatch("private", "off", fresh(), laptop, { online: { openrouter: false, freellm: true } })).toEqual({ ok: true, patch: { okFilow: { provider: "freellm" } } });
    const after = apply(fresh(), "private", "off", laptop);
    // takes stay on Auto (never an online take by itself), the voice and translation stay on this PC
    expect(after).toEqual({ ...fresh(), okFilow: { ...fresh().okFilow, provider: "cloud" } });
    expect(easyRead(after, laptop).private).toBe("off");
  });

  it("off without an online service set up: says so and writes nothing", () => {
    expect(easyPatch("private", "off", fresh(), laptop, NONE)).toEqual({ ok: false, needs: "online-service" });
    expect(easyView(fresh(), laptop, NONE).private.onlineReady).toBe(false);
    expect(easyView(fresh(), laptop, BOTH).private.onlineReady).toBe(true);
  });
});

describe("Look at my screen", () => {
  const small = machine(8, 4);

  it("is off until the user chooses where this PC answers from the words alone, and says it is slow there", () => {
    expect(easyRead(fresh(), small).screen).toBe("off");
    expect(easyView(fresh(), small, NONE).screen).toEqual({ slow: true, leaves: false });
    expect(easyView(fresh(), laptop, NONE).screen).toEqual({ slow: false, leaves: false });
    // nothing is written for a switch that already reads off: the stored choice stays "auto"
    expect(easyPatch("screen", "off", fresh(), small, NONE)).toEqual({ ok: true, patch: {} });
  });

  it("the user still chooses on a slow PC: on is written as their own choice and reads on", () => {
    expect(easyPatch("screen", "on", fresh(), small, NONE)).toEqual({ ok: true, patch: { okFilow: { seeScreen: "on" } } });
    const on = apply(fresh(), "screen", "on", small);
    expect(easyRead(on, small).screen).toBe("on");
    // still slow, and said so: the choice does not hide the reason
    expect(easyView(on, small, NONE).screen.slow).toBe(true);
  });

  it("follows where answers come from and a pinned setup while the user has not chosen", () => {
    const onlineAnswers = apply(fresh(), "private", "off", small);
    expect(easyRead(onlineAnswers, small).screen).toBe("on");
    expect(easyPatch("screen", "off", onlineAnswers, small, BOTH)).toEqual({ ok: true, patch: { okFilow: { seeScreen: "off" } } });
    // Balanced pinned in Advanced on a small PC reads pictures; Faster pinned on a laptop does not
    expect(easyRead({ ...fresh(), local: { ...fresh().local, setup: "standard" } }, small).screen).toBe("on");
    expect(easyRead({ ...fresh(), local: { ...fresh().local, setup: "lite" } }, laptop).screen).toBe("off");
  });

  it("a choice holds when answers move online or back: off stays off, on stays on", () => {
    const off = apply(fresh(), "screen", "off", laptop);
    expect(easyRead(apply(off, "private", "off", laptop), laptop).screen).toBe("off");
    const on = apply(fresh(), "screen", "on", small);
    expect(easyRead(apply(apply(on, "private", "off", small), "private", "on", small), small).screen).toBe("on");
  });

  it("says when a picture of the screen leaves this PC: on, with answers from online, and only then", () => {
    const onlineAnswers = apply(fresh(), "private", "off", laptop);
    expect(easyView(onlineAnswers, laptop, BOTH).screen.leaves).toBe(true);
    expect(easyView(apply(onlineAnswers, "screen", "off", laptop), laptop, BOTH).screen.leaves).toBe(false);
    expect(easyView(fresh(), laptop, BOTH).screen.leaves).toBe(false);
  });

  it("the user's off is written as off, on as on, and reset puts the choice back to the setup", () => {
    expect(easyPatch("screen", "off", fresh(), laptop, NONE)).toEqual({ ok: true, patch: { okFilow: { seeScreen: "off" } } });
    const off = apply(fresh(), "screen", "off", laptop);
    expect(easyPatch("screen", "on", off, laptop, NONE)).toEqual({ ok: true, patch: { okFilow: { seeScreen: "on" } } });
    const on = apply(off, "screen", "on", laptop);
    // reads as recommended already, yet the stored choice is the user's: reset lists it and writes "auto"
    expect(easyReset(on, laptop, NONE)).toEqual({ patch: { okFilow: { seeScreen: "auto" } }, changes: ["screen"] });
  });
});

describe("Speed or quality", () => {
  const options = (m: MachineInfo, s = fresh()) => easyView(s, m, NONE).quality.options;

  it("Best quality is shown but refused, with the reason, where the graphics memory is under 8 GB or Ollama cannot use the card", () => {
    for (const m of [machine(16, 8), machine(8, 4), machine(32, 16, rtx(6)), machine(64, 32, { kind: "discrete", vramGb: 16, ollama: false })]) {
      expect(options(m), JSON.stringify(m)).toContain("best");
      expect(easyView(fresh(), m, NONE).quality.bestBlocked, JSON.stringify(m)).toBe("stronger-pc");
      expect(easyPatch("quality", "best", fresh(), m, NONE), JSON.stringify(m)).toEqual({ ok: false, needs: "stronger-pc" });
    }
  });

  it("the user decides from 8 GB: under 12 GB the choice comes with the wait said, from 12 GB with nothing to say", () => {
    // disk too full for the big download: the PC is chosen Balanced, so Best quality is a real other choice
    const eight = machine(32, 16, rtx(8), 5), twelve = machine(32, 16, rtx(12), 5);
    for (const [m, note] of [[eight, "shared-card"], [machine(32, 16, rtx(11.9), 5), "shared-card"], [twelve, null]] as const) {
      const roomy = { ...m, freeDiskGb: 200 };
      expect(easyView(fresh(), roomy, NONE).quality, JSON.stringify(m)).toMatchObject({ bestBlocked: null, bestNote: note });
      expect(easyPatch("quality", "best", fresh(), roomy, NONE), JSON.stringify(m)).toEqual({ ok: true, patch: { local: { setup: "advanced" } } });
    }
    expect(easyView(fresh(), machine(16, 8), NONE).quality.bestNote).toBeNull();
  });

  it("Best quality pinned in Advanced reads Best quality from an 8 GB card, Custom on a PC that cannot carry it", () => {
    const pinned = { ...fresh(), local: { ...fresh().local, setup: "advanced" as const } };
    expect(easyRead(pinned, machine(16, 8, rtx(8))).quality).toBe("best");
    expect(easyRead(pinned, machine(32, 16, rtx(12))).quality).toBe("best");
    expect(easyRead(pinned, machine(16, 8)).quality).toBe("custom");
    expect(options(machine(32, 16, rtx(12)), pinned)).toEqual(["faster", "auto", "best"]);
  });

  it("an option equal to what Chosen for this PC already gives is not shown", () => {
    expect(options(machine(8, 4))).toEqual(["auto", "best"]);
    expect(options(machine(16, 8))).toEqual(["faster", "auto", "best"]);
    expect(options(machine(16, 8, rtx(8)))).toEqual(["faster", "auto"]);
    expect(options(machine(32, 16, rtx(12)))).toEqual(["faster", "auto"]);
    expect(options(machine(32, 10, { kind: "unified", vramGb: 32 }))).toEqual(["faster", "auto"]);
    // Faster pinned on a small PC stays visible as the selected option
    expect(options(machine(8, 4), { ...fresh(), local: { ...fresh().local, setup: "lite" } })).toEqual(["faster", "auto", "best"]);
  });

  it("a strong card with a full disk: Best quality is shown, needs disk, and is refused until there is room", () => {
    const full = machine(32, 16, rtx(12), 5);
    expect(easyView(fresh(), full, NONE).quality).toMatchObject({ options: ["faster", "auto", "best"], bestBlocked: "disk", chosen: "standard", active: "standard" });
    expect(easyPatch("quality", "best", fresh(), full, NONE)).toEqual({ ok: false, needs: "disk" });
    expect(easyView(fresh(), { ...full, freeDiskGb: 200 }, NONE).quality.bestBlocked).toBeNull();
  });

  describe("the downloads it offers (never started by itself)", () => {
    const have = (m: MachineInfo, ...installed: string[]): MachineInfo => ({ ...m, installed });
    const offers = (m: MachineInfo, s = fresh()) => easyView(s, m, NONE).quality.downloads.map((d) => `${d.id}:${d.models.map((x) => x.name).join("+")}:${d.gb}:${d.preselected ? "suggested" : "by choice"}`);
    const twelve = machine(32, 16, rtx(12)), eight = machine(16, 8, rtx(8));

    it("offers nothing while the installed models are unknown", () => {
      expect(easyView(fresh(), twelve, NONE).quality.downloads).toEqual([]);
    });

    it("from 12 GB of graphics memory the Best quality pair is the suggestion, the small helper the other choice", () => {
      expect(offers(have(twelve))).toEqual(["helper:qwen3-vl:2b:1.9:by choice", "best:gemma4:e4b+lfm3-vl:7.6:suggested"]);
    });

    it("on an 8 GB card the small helper is the suggestion and the pair is there by choice", () => {
      expect(offers(have(eight))).toEqual(["helper:qwen3-vl:2b:1.9:suggested", "best:gemma4:e4b+lfm3-vl:7.6:by choice"]);
    });

    it("only what is missing is offered, with its own size, and nothing once the pair is here", () => {
      expect(offers(have(twelve, "qwen3-vl:2b", "lfm3-vl:latest"))).toEqual(["best:gemma4:e4b:6.1:suggested"]);
      expect(offers(have(twelve, "gemma4:e4b", "lfm3-vl:latest"))).toEqual([]);
      expect(easyView(fresh(), have(twelve, "gemma4:e4b", "lfm3-vl:latest"), NONE).quality.helpers).toEqual(["gemma4:e4b", "lfm3-vl"]);
      expect(easyView(fresh(), have(twelve), NONE).quality.helpers).toEqual(["qwen3-vl:2b"]);
    });

    it("a PC that is not on Best quality is offered its own helper only", () => {
      expect(offers(have(laptop))).toEqual(["helper:lfm3-vl:1.5:suggested"]);
      expect(offers(have(laptop, "lfm3-vl:latest"))).toEqual([]);
      // Faster pinned on a strong PC: no pair
      expect(offers(have(twelve), { ...fresh(), local: { ...fresh().local, setup: "lite" } })).toEqual(["helper:lfm3-vl:1.5:suggested"]);
      // too small to answer by itself: nothing to fetch
      expect(offers(have(machine(4, 2)))).toEqual([]);
    });

    it("says when the disk cannot take a download with the spare left over", () => {
      const room = (freeDiskGb: number) => easyView(fresh(), have({ ...twelve, freeDiskGb }, "clef-flash"), NONE).quality.downloads.map((d) => d.room);
      expect(room(200)).toEqual([true, true]);
      // 7.6 GB and 4 GB spare do not fit in 10 GB; 1.9 GB and the spare do
      expect(room(10)).toEqual([true, false]);
    });
  });

  it("maps to the setup preference: Chosen for this PC = auto, Faster = lite", () => {
    expect(easyPatch("quality", "faster", fresh(), laptop, NONE)).toEqual({ ok: true, patch: { local: { setup: "lite" } } });
    expect(easyPatch("quality", "auto", apply(fresh(), "quality", "faster", laptop), laptop, NONE)).toEqual({ ok: true, patch: { local: { setup: "auto" } } });
  });
});

describe("the other controls", () => {
  it("Answer out loud: off is no voice, on is the automatic voice", () => {
    expect(easyPatch("voice", "off", fresh(), laptop, NONE)).toEqual({ ok: true, patch: { okFilow: { voice: "off" } } });
    expect(easyPatch("voice", "on", apply(fresh(), "voice", "off", laptop), laptop, NONE)).toEqual({ ok: true, patch: { okFilow: { voice: "system", voiceChosen: false } } });
    expect(easyPatch("voice", "on", apply(fresh(), "voice", "off", laptop), laptop, { ...NONE, naturalVoice: true })).toEqual({ ok: true, patch: { okFilow: { voice: "natural", voiceChosen: false } } });
  });

  it("Tidy up writes its three settings together and is not usable while dictation is off", () => {
    expect(easyPatch("tidy", "off", fresh(), laptop, NONE)).toEqual({ ok: true, patch: { dictation: { cleanup: false, punctuate: false, removeFillers: false } } });
    const partly = fresh();
    partly.dictation.punctuate = false;
    expect(easyPatch("tidy", "on", partly, laptop, NONE)).toEqual({ ok: true, patch: { dictation: { punctuate: true } } });
    expect(easyView(fresh(), laptop, NONE).tidy.usable).toBe(true);
    expect(easyView(apply(fresh(), "dictation", "off", laptop), laptop, NONE).tidy.usable).toBe(false);
  });

  it("Language sets the interface language only and never the spoken one", () => {
    const r = easyPatch("language", "it", fresh(), laptop, NONE);
    expect(r).toEqual({ ok: true, patch: { ui: { lang: "it" } } });
    const pinned = { ...fresh(), speechLanguage: "ja" as const };
    expect(applyEasyPatch(pinned, (r as { patch: EasyPatch }).patch).speechLanguage).toBe("ja");
    expect(easyView(pinned, laptop, NONE).language.listensIn).toBe("ja");
    expect(easyView(fresh(), laptop, NONE).language.listensIn).toBeNull();
  });

  it("Start with Windows is off until the user turns it on", () => {
    expect(easyPatch("startup", "on", fresh(), laptop, NONE)).toEqual({ ok: true, patch: { ui: { runAtStartup: true } } });
  });
});

describe("a patch stays inside its control's own settings", () => {
  const ALLOWED: Record<EasyControl, string[]> = {
    private: ["okFilow.provider", "okFilow.voice", "okFilow.voiceChosen", "local.startMode", "local.translateWhere"],
    screen: ["okFilow.seeScreen"],
    voice: ["okFilow.voice", "okFilow.voiceChosen"],
    dictation: ["dictation.enabled"],
    tidy: ["dictation.cleanup", "dictation.punctuate", "dictation.removeFillers"],
    quality: ["local.setup"],
    language: ["ui.lang"],
    startup: ["ui.runAtStartup"],
  };
  const VALUES: Record<EasyControl, string[]> = { private: ["on", "off"], screen: ["on", "off"], voice: ["on", "off"], dictation: ["on", "off"], tidy: ["on", "off"], quality: ["auto", "faster", "best"], language: ["", "en", "it", "ru", "ro", "ja"], startup: ["on", "off"] };
  const keys = (p: EasyPatch) => Object.entries(p).flatMap(([store, v]) => Object.keys(v as object).map((k) => `${store}.${k}`));

  it("for every control, value, starting point and machine", () => {
    const starts: EasySnapshot[] = [fresh(), { okFilow: { provider: "freellm", voice: "cloud", seeScreen: "off" }, dictation: { enabled: false, cleanup: false, punctuate: true, removeFillers: false }, ui: { lang: "ro", runAtStartup: true }, local: { setup: "standard", startMode: "ask", translateWhere: "cloud" }, speechLanguage: "it" }];
    let writes = 0;
    for (const s of starts) for (const { m } of TIERS) for (const control of EASY_CONTROLS) for (const value of VALUES[control]) {
      const r = easyPatch(control, value as never, s, m, BOTH);
      if (!r.ok) continue;
      const k = keys(r.patch);
      writes += k.length;
      expect(k.filter((x) => !ALLOWED[control].includes(x)), `${control}=${value}`).toEqual([]);
      // and every write changes something (voiceChosen rides along with a voice write only)
      const after = applyEasyPatch(s, r.patch);
      expect(k.filter((x) => x !== "okFilow.voiceChosen" && (after as never)[x.split(".")[0]][x.split(".")[1]] === (s as never)[x.split(".")[0]][x.split(".")[1]]), `${control}=${value}`).toEqual([]);
      if (k.includes("okFilow.voiceChosen")) expect(k).toContain("okFilow.voice");
    }
    expect(writes).toBeGreaterThan(100);
  });
});
