import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DICTIONARIES, EASY_CONTROLS, easyPatch, easyView, t, type EasyCaps, type EasyControl, type EasyPatch, type EasySnapshot, type Lang, type MachineInfo } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { EasySettings, type EasySettingsProps } from "./EasySettings";
import { downloadHref, easySnapshot, easyVisible, writeEasyPatch, type EasyIo } from "@/lib/easy/io";

const laptop: MachineInfo = { ramGb: 16, cores: 8, gpu: { kind: "none", vramGb: null }, freeDiskGb: 200, installed: ["lfm3-vl:latest"] };
const small: MachineInfo = { ramGb: 8, cores: 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: 200, installed: ["lfm3-vl:latest"] };
const rtx = (vramGb: number, installed: string[] = []): MachineInfo => ({ ramGb: 32, cores: 16, gpu: { kind: "discrete", vramGb }, freeDiskGb: 400, installed });
const NONE: EasyCaps = { online: { openrouter: false, freellm: false } };
const KEY: EasyCaps = { online: { openrouter: true, freellm: false } };
const fresh = (): EasySnapshot => easySnapshot({ okFilow: null, dictation: null, ui: { lang: "", runAtStartup: false }, local: { setup: "auto", startMode: "auto", translateWhere: "local" }, speechLanguage: "auto" });

const render = (s: EasySnapshot, m: MachineInfo = laptop, caps: EasyCaps = NONE, extra: Partial<EasySettingsProps> = {}, lang: Lang = "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <EasySettings view={easyView(s, m, caps)} visible={[...EASY_CONTROLS]} keys="Ctrl + Win" mac={false} systemLang="en" startup={null} refused={{}} busy={false} message="" onChange={() => {}} onReset={() => {}}
        advancedHref="/settings/local" keyHref="/settings/local#freellm" downloadHref={(d) => downloadHref(d.models.map((x) => x.name))} size={(gb) => `${gb} GB`} modelName={(n) => n} {...extra} />
    </LangProvider>,
  );
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The markup of one control's row. */
const row = (html: string, control: EasyControl) => {
  const at = html.indexOf(`data-easy="${control}"`);
  const next = html.indexOf('data-easy="', at + 10);
  return html.slice(html.lastIndexOf("<div", at), next < 0 ? undefined : html.lastIndexOf("<div", next));
};
/** The input tag of one option of the choice. */
const radio = (html: string, value: string) => [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((x) => x[0]).find((x) => x.includes(`value="${value}"`)) ?? "";
const state = (html: string, control: EasyControl) => /data-state="([^"]*)"/.exec(row(html, control))?.[1];
const en = DICTIONARIES.en as Record<string, string>;

describe("the Easy page", () => {
  it("shows the eight controls in order, each with its name and one sentence, and reads as recommended on a fresh profile", () => {
    const html = render(fresh());
    expect([...html.matchAll(/data-easy="([a-z]+)"/g)].map((x) => x[1])).toEqual([...EASY_CONTROLS]);
    for (const c of EASY_CONTROLS) expect(plain(row(html, c)), c).toContain(en[`easy.${c}`]);
    for (const c of ["private", "screen", "voice", "tidy", "language", "startup"] as const) expect(plain(row(html, c)), c).toContain(en[`easy.${c}.desc`]);
    expect(plain(row(html, "dictation"))).toContain("Hold Ctrl + Win, speak, let go");
    expect(EASY_CONTROLS.map((c) => state(html, c))).toEqual(["on", "on", "on", "on", "on", "auto", "auto", "off"]);
    // nothing to put back: no reset button
    expect(html).not.toContain(en["easy.reset"]);
  });

  it("every switch is a native, labelled switch with its sentence as description; the choice is a named radio group", () => {
    const html = render(fresh());
    const switches = [...html.matchAll(/<input[^>]*role="switch"[^>]*>/g)].map((x) => x[0]);
    expect(switches).toHaveLength(6);
    for (const s of switches) {
      const id = /id="([^"]+)"/.exec(s)![1];
      expect(s).toContain('type="checkbox"');
      expect(html).toContain(`<label class="easy-name" for="${id}">`);
      // described by its sentence and by the warnings under it
      expect(/aria-describedby="([^"]+)"/.exec(s)![1]).toBe(`${id}-desc ${id}-notes`);
      expect(html).toContain(`<p class="easy-desc" id="${id}-desc">`);
      expect(html).toContain(`<div class="easy-notes" id="${id}-notes">`);
    }
    // a warning sits inside what its switch is described by
    const slow = row(render(fresh(), small), "screen");
    expect(slow).toMatch(/<div class="easy-notes" id="[^"]+"><p class="easy-note">Looking at the screen is slow/);
    expect(row(html, "quality")).toMatch(/<fieldset[^>]*>\s*<legend class="easy-name">Speed or quality<\/legend>/);
    expect([...row(html, "quality").matchAll(/type="radio"/g)]).toHaveLength(3);
    expect(row(html, "language")).toMatch(/<label class="easy-name" for="([^"]+)">Language<\/label>[\s\S]*<select id="\1"/);
    // the state is also a word, not only a colour
    expect(plain(row(html, "private"))).toMatch(/ On /);
    expect(plain(row(html, "startup"))).toMatch(/ Off /);
  });

  it("Custom: the switch is not checked, the word Custom is shown, the sentence says what differs and links to Advanced", () => {
    const s = fresh();
    s.local.startMode = "ask"; s.okFilow.voice = "cloud"; s.dictation.punctuate = false; s.local.setup = "standard";
    const html = render(s);
    expect([state(html, "private"), state(html, "voice"), state(html, "tidy"), state(html, "quality")]).toEqual(["custom", "custom", "custom", "custom"]);
    for (const c of ["private", "voice", "tidy"] as const) {
      expect(row(html, c), c).toContain('class="easy-row custom"');
      expect(row(html, c), c).not.toMatch(/<input[^>]*checked=""/);
      // neither on nor off: a mixed checkbox, not a switch that would be announced as off
      expect(row(html, c), c).toMatch(/<input[^>]*type="checkbox"[^>]*aria-checked="mixed"/);
      expect(row(html, c), c).not.toContain('role="switch"');
      expect(plain(row(html, c)), c).toMatch(/ Custom /);
      expect(row(html, c), c).toContain('<a href="/settings/local">See in Advanced settings</a>');
    }
    expect(plain(row(html, "private"))).toContain("Custom: answers stay on this PC, but the voice is an online one, Filow asks where to listen each time you start a talk.");
    // no radio is selected under a pinned Balanced, and a text row says so
    for (const q of ["faster", "auto", "best"]) expect(radio(row(html, "quality"), q), q).not.toContain('checked=""');
    expect(plain(row(html, "quality"))).toContain("Custom: Balanced, set in Advanced settings. See in Advanced settings");
    // and the way back to the recommended values is offered
    expect(html).toContain(en["easy.reset"]);
  });

  it("the reset question lists what will be put back and what is never touched", () => {
    const s = fresh();
    s.okFilow.voice = "off"; s.ui.runAtStartup = true;
    const text = plain(render(s, laptop, NONE, { confirming: true }));
    expect(text).toContain("Reset to recommended?");
    expect(text).toContain("This puts back: Answer out loud, Start with Windows.");
    // Japanese joins a list with its own comma
    expect(plain(render(s, laptop, NONE, { confirming: true }, "ja"))).toContain(`${t("easy.voice", "ja")}、${t("easy.startup", "ja")}`);
    expect(text).toContain("What you allowed to be sent online and everything in Advanced settings stay as they are.");
    expect(text).toMatch(/Cancel\s+Reset/);
  });

  describe("Keep it on this PC", () => {
    it("on: says everything stays here, and what turning it off would mean, before any click", () => {
      const html = row(render(fresh()), "private");
      const text = plain(html);
      expect(text).toContain("Nothing is sent to an online service.");
      expect(text).toContain("Turn this off to let OK Filow answer online instead: quicker, and with better drawings.");
      expect(text).toContain("Your question then leaves this PC, with a picture of your screen while Look at my screen is on.");
      expect(text).toContain("It needs a key from an online service.");
      // no alert and no link to add a key while nobody asked
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain("Add a key");
      // once answers are online the page says what is happening, not what would
      const off = fresh();
      off.okFilow.provider = "cloud";
      expect(plain(row(render(off, laptop, KEY), "private"))).not.toContain("Turn this off to let");
    });

    it("off: says in plain words that the question leaves this PC, and the picture of the screen when Look at my screen is on", () => {
      const off = fresh();
      off.okFilow.provider = "cloud";
      const withScreen = plain(row(render(off, laptop, KEY), "private"));
      expect(withScreen).toContain("Each time you ask, your question leaves this PC.");
      expect(withScreen).toContain("A picture of your screen goes with it, because Look at my screen is on.");
      expect(withScreen).toContain("Filow asks you the first time and shows a sign every time something is sent.");
      expect(plain(row(render(off, laptop, KEY), "screen"))).toContain("the picture of your screen leaves this PC with each question");
      off.okFilow.seeScreen = "off";
      const without = plain(row(render(off, laptop, KEY), "private"));
      expect(without).toContain("No picture of your screen is sent, because Look at my screen is off.");
      expect(without).not.toContain("A picture of your screen goes with it");
      expect(plain(row(render(off, laptop, KEY), "screen"))).not.toContain("leaves this PC");
    });

    it("turned off without a key: the switch stays on and the page says a key is needed, with the place to add it", () => {
      const html = row(render(fresh(), laptop, NONE, { refused: { private: "online-service" } }), "private");
      expect(state(html, "private")).toBe("on");
      expect(html).toMatch(/<p class="easy-note" role="alert">Answers online need a key from an online service\. Until you add one, answers stay on this PC\. <a href="\/settings\/local#freellm">Add a key<\/a><\/p>/);
    });

    it("a PC too small to answer by itself says so, and what to do", () => {
      const tiny: MachineInfo = { ramGb: 4, cores: 2, gpu: { kind: "none", vramGb: null }, freeDiskGb: 200, installed: [] };
      expect(plain(row(render(fresh(), tiny), "private"))).toContain("This computer is too small to answer questions by itself.");
      expect(plain(row(render(fresh(), laptop), "private"))).not.toContain("too small");
      // it needs a key and none is set up: said with the place to add one, as information, not as an alarm
      expect(row(render(fresh(), tiny), "private")).toContain('<a href="/settings/local#freellm">Add a key</a>');
      expect(row(render(fresh(), tiny), "private")).not.toContain('role="alert"');
    });
  });

  it("Look at my screen on a slow PC: off, usable, and the reason is visible text", () => {
    const html = row(render(fresh(), small), "screen");
    expect(state(html, "screen")).toBe("off");
    expect(html).not.toMatch(/<input[^>]*disabled=""/);
    expect(plain(html)).toContain("Looking at the screen is slow on this computer, so it starts off. You can still turn it on.");
    expect(plain(row(render(fresh(), laptop), "screen"))).not.toContain("slow");
  });

  it("Tidy up is shown but not usable while dictation is off, with the reason", () => {
    const s = fresh();
    s.dictation.enabled = false;
    const html = row(render(s), "tidy");
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(plain(html)).toContain("Turn on Dictate into any app to use this.");
    expect(row(render(fresh()), "tidy")).not.toMatch(/<input[^>]*disabled=""/);
  });

  describe("Speed or quality", () => {
    const quality = (m: MachineInfo, s = fresh()) => row(render(s, m), "quality");

    it("names what was chosen for this PC without figures or hardware words", () => {
      expect(plain(quality(laptop))).toContain("Chosen for this PC A good balance for a computer like this one.");
      expect(plain(quality(small))).toContain("Chosen for this PC The light setup, so it stays fast on this computer.");
      expect(plain(quality(rtx(12)))).toContain("Chosen for this PC The best quality, because this computer is powerful enough for it.");
    });

    it("Best quality on a PC that cannot carry it: shown, not selectable, the reason as visible text", () => {
      const html = quality(laptop);
      expect(radio(html, "best")).toContain('disabled=""');
      expect(plain(html)).toContain("Best quality This computer is not powerful enough for Best quality.");
      expect(radio(html, "faster")).not.toContain('disabled=""');
      expect(radio(html, "auto")).toContain('checked=""');
    });

    it("no model name in a label: names appear only in the small detail lines", () => {
      const html = quality(rtx(12));
      const names = /qwen3-vl:2b|gemma4:e4b|lfm3-vl/;
      expect(html).toMatch(names);
      const outsideDetail = html.replace(/<(p|span) class="easy-detail">[^<]*<\/\1>/g, "").replace(/href="[^"]*"/g, "");
      expect(outsideDetail).not.toMatch(names);
    });

    it("from 12 GB the Best quality helpers are the suggestion; each download is a link the user clicks, with its size", () => {
      const html = quality(rtx(12));
      expect(html).toMatch(/data-download="best"[\s\S]*Suggested for this PC[\s\S]*<a class="btn primary" href="\/settings\/local\?auto=gemma4%3Ae4b,lfm3-vl#models">Download 7\.6 GB<\/a>/);
      expect(html).toMatch(/data-download="helper"[\s\S]*<a class="btn " href="\/settings\/local\?auto=qwen3-vl%3A2b#models">Download 1\.9 GB<\/a>/);
      expect(plain(html)).toContain("Nothing is downloaded until you click.");
      // nothing on the page starts a download by itself: no button, form or script, only links
      expect(html).not.toMatch(/<button|<form/);
    });

    it("an 8 GB card gets Best quality by itself, so the waiting it brings is said under Chosen for this PC", () => {
      const wait = "answers about your screen can take a few minutes while Filow is following a talk";
      expect(plain(quality(rtx(8)))).toContain(`Chosen for this PC The best quality, because this computer is powerful enough for it. On this computer, ${wait}.`);
      expect(plain(quality(rtx(12)))).not.toContain(wait);
      expect(plain(quality(laptop))).not.toContain(wait);
    });

    it("on an 8 GB card the small helper is the suggestion and the larger download says what waiting it brings", () => {
      const html = quality(rtx(8));
      expect(html).toMatch(/data-download="helper"[\s\S]*Suggested for this PC[\s\S]*<a class="btn primary"[^>]*>Download 1\.9 GB<\/a>/);
      expect(html).toMatch(/data-download="best"[\s\S]*answers about your screen can take a few minutes[\s\S]*<a class="btn "[^>]*>Download 7\.6 GB<\/a>/);
    });

    it("says what answers now once nothing is left to fetch, and says when the disk is too full for a download", () => {
      expect(plain(quality(rtx(12, ["gemma4:e4b", "lfm3-vl:latest"])))).toContain("Answering on this PC now: gemma4:e4b, lfm3-vl.");
      const full = quality({ ...rtx(12, ["clef-flash", "qwen3-vl:2b"]), freeDiskGb: 8 });
      expect(plain(full)).toContain("Not enough free disk space for this download (7.6 GB).");
      expect(full).not.toContain("auto=gemma4");
    });
  });

  it("Language offers Automatic with the system language and the five languages in their own names", () => {
    const html = row(render(fresh(), laptop, NONE, { systemLang: "it" }), "language");
    expect([...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((x) => x[1])).toEqual(["Automatic (Italiano)", "English", "Italiano", "Русский", "Română", "日本語"]);
    const pinned = { ...fresh(), speechLanguage: "ja" as const };
    expect(plain(row(render(pinned), "language"))).toContain("You set Filow to listen in 日本語.");
  });

  it("Start with Windows: Open at login on a Mac, and the system's refusal is said under the switch", () => {
    expect(plain(row(render(fresh(), laptop, NONE, { mac: true }), "startup"))).toContain("Open at login");
    expect(plain(row(render(fresh(), laptop, NONE, { startup: "blocked" }), "startup"))).toContain(en["ui.startupBlocked"]);
  });

  it("in the browser (no desktop app behind the page) only the controls that work are drawn, and the page says where the others are", () => {
    const visible = easyVisible({});
    expect(visible).toEqual(["quality", "language"]);
    const html = render(fresh(), laptop, NONE, { visible });
    expect([...html.matchAll(/data-easy="([a-z]+)"/g)].map((x) => x[1])).toEqual(["quality", "language"]);
    expect(html).not.toContain('role="switch"');
    expect(plain(html)).toContain("The other settings are in the Filow app on your computer.");
    expect(plain(render(fresh()))).not.toContain("The other settings are in the Filow app");
    // the desktop app on a system without a startup setting: seven controls, and no such sentence
    const seven = EASY_CONTROLS.filter((c) => c !== "startup");
    expect(easyVisible({ okFilow: async () => {}, dictation: async () => {} })).toEqual(seven);
    expect(plain(render(fresh(), laptop, NONE, { visible: seven }))).not.toContain("The other settings are in the Filow app");
    // a change in a hidden control is not offered for reset
    const s = fresh();
    s.okFilow.voice = "off";
    expect(render(s, laptop, NONE, { visible })).not.toContain(en["easy.reset"]);
  });

  it("is written in each of the five languages, with no English left on the page", () => {
    const s = fresh();
    s.okFilow.voice = "cloud";
    for (const lang of ["it", "ru", "ro", "ja"] as const) {
      const text = plain(render(s, rtx(8), KEY, {}, lang));
      for (const key of ["easy.title", "easy.intro", "easy.private", "easy.voice.custom", "easy.quality.chosen.advanced", "easy.download.best", "easy.download.note", "easy.advanced", "easy.advanced.desc", "easy.reset"] as const) {
        expect(text, `${lang} ${key}`).toContain(t(key, lang));
        expect(t(key, lang), `${lang} ${key}`).not.toBe(en[key]);
      }
      expect(text, lang).not.toMatch(/Custom|Chosen for|Download \d|Advanced settings|Suggested/);
    }
  });
});

describe("reading and writing the stores", () => {
  it("a store that is not there reads as a fresh profile; an older desktop build without the newer fields reads their defaults", () => {
    expect(fresh()).toMatchObject({ okFilow: { provider: "local", voice: "system", seeScreen: "auto" }, dictation: { enabled: true, cleanup: true, punctuate: true, removeFillers: true } });
    const old = easySnapshot({ okFilow: { provider: "cloud", voice: "natural" }, dictation: { enabled: false, cleanup: false, removeFillers: true }, ui: { lang: "it", runAtStartup: true }, local: { setup: "lite", startMode: "ask", translateWhere: "cloud" }, speechLanguage: "ru" });
    expect(old).toEqual({ okFilow: { provider: "cloud", voice: "natural", seeScreen: "auto" }, dictation: { enabled: false, cleanup: false, punctuate: true, removeFillers: true }, ui: { lang: "it", runAtStartup: true }, local: { setup: "lite", startMode: "ask", translateWhere: "cloud" }, speechLanguage: "ru" });
  });

  const io = () => {
    const calls: string[] = [];
    const log = (name: string) => (v: unknown) => { calls.push(`${name}:${JSON.stringify(v)}`); };
    const api: EasyIo = {
      okFilow: async (p) => log("okFilow")(p), dictation: async (p) => log("dictation")(p), startup: async (on) => { log("startup")(on); return true; },
      lang: log("lang"), setup: log("setup"), startMode: log("startMode"), translateWhere: log("translateWhere"),
    };
    return { api, calls };
  };

  it("each store gets exactly the keys of the patch, and nothing else is written", async () => {
    const { api, calls } = io();
    const patch: EasyPatch = { okFilow: { provider: "local", voice: "system", voiceChosen: false }, dictation: { cleanup: true }, ui: { lang: "", runAtStartup: false }, local: { setup: "auto", startMode: "auto", translateWhere: "local" } };
    expect(await writeEasyPatch(patch, api)).toBe(true);
    expect(calls).toEqual(['okFilow:{"provider":"local","voice":"system","voiceChosen":false}', 'dictation:{"cleanup":true}', 'lang:""', "startup:false", 'setup:"auto"', 'startMode:"auto"', 'translateWhere:"local"']);
    const one = io();
    expect(await writeEasyPatch({ local: { setup: "lite" } }, one.api)).toBe(true);
    expect(one.calls).toEqual(['setup:"lite"']);
    const none = io();
    expect(await writeEasyPatch({}, none.api)).toBe(true);
    expect(none.calls).toEqual([]);
  });

  it("the writes of a real action reach the right store: Keep it on this PC off writes only where answers come from", async () => {
    const { api, calls } = io();
    const r = easyPatch("private", "off", fresh(), laptop, KEY);
    expect(r.ok && (await writeEasyPatch(r.patch, api))).toBe(true);
    expect(calls).toEqual(['okFilow:{"provider":"cloud"}']);
  });

  it("says it failed when a store is missing, a write throws, or the system refuses the startup change", async () => {
    const { api } = io();
    expect(await writeEasyPatch({ okFilow: { voice: "off" } }, { ...api, okFilow: undefined })).toBe(false);
    expect(await writeEasyPatch({ dictation: { enabled: false } }, { ...api, dictation: undefined })).toBe(false);
    expect(await writeEasyPatch({ dictation: { enabled: false } }, { ...api, dictation: vi.fn().mockRejectedValue(new Error("gone")) })).toBe(false);
    expect(await writeEasyPatch({ ui: { runAtStartup: true } }, { ...api, startup: async () => false })).toBe(false);
    expect(await writeEasyPatch({ ui: { runAtStartup: true } }, { ...api, startup: undefined })).toBe(false);
  });

  it("a download address names its models and lands on the list that runs it", () => {
    expect(downloadHref(["gemma4:e4b", "lfm3-vl"])).toBe("/settings/local?auto=gemma4%3Ae4b,lfm3-vl#models");
    expect(new URLSearchParams(downloadHref(["gemma4:e4b", "lfm3-vl"]).split("?")[1].split("#")[0]).get("auto")!.split(",")).toEqual(["gemma4:e4b", "lfm3-vl"]);
  });
});
