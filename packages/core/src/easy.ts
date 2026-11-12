// Easy settings: eight plain controls in front of the detailed settings. Pure and without a store of
// its own: every control is read from the settings that already exist and written back as a patch
// to them, so the Easy page and the Advanced page can never disagree. Which setup a machine gets
// comes from profile.ts (recommendProfile, setupChoices); no hardware rule is repeated here.
import type { SpokenLang } from "./spoken";
import type { UiLanguage } from "./ui-preferences";
import { bestQualityPairMissing, DOWNLOAD_SPARE_GB, missingModels, recommendProfile, resolveSetup, setupChoices, type MachineInfo, type SetupModel, type SetupPreference, type SetupProfileId } from "./profile";

/** The eight controls, in the order the page shows them. */
export const EASY_CONTROLS = ["private", "screen", "voice", "dictation", "tidy", "quality", "language", "startup"] as const;
export type EasyControl = (typeof EASY_CONTROLS)[number];

export type EasySwitch = "on" | "off";
export type EasyQuality = "auto" | "faster" | "best";

/**
 * What the controls read. Each field is an existing setting:
 * - okFilow: settings.json `okFilow.*` (apps/desktop/okfilow.js). `seeScreen` is the "Look at my
 *   screen" switch of the OK Filow panel: "on" or "off" once the user chose, "auto" until then (the
 *   setup for this computer decides, apps/web/lib/buddy/sees.ts); a build without it reads "auto".
 * - dictation: settings.json `dictation.*` (apps/desktop/dictation-core.js).
 * - ui: interface language and start with Windows (ui-preferences.ts).
 * - local: the three choices kept in the page's localStorage (apps/web/lib/prefs.ts, translateWhere.ts).
 * - speechLanguage: read only; the Language control never writes it.
 */
export type EasySnapshot = {
  okFilow: { provider: "local" | "cloud" | "freellm"; voice: "system" | "natural" | "cloud" | "off"; seeScreen: "auto" | "on" | "off" };
  dictation: { enabled: boolean; cleanup: boolean; punctuate: boolean; removeFillers: boolean };
  ui: { lang: UiLanguage; runAtStartup: boolean };
  local: { setup: SetupPreference; startMode: "ask" | "auto" | "cloud" | "local"; translateWhere: "local" | "cloud" };
  speechLanguage: "auto" | SpokenLang;
};

/**
 * Which online services the user has set up: turning "Keep it on this PC" off needs one.
 * `naturalVoice`: the natural voice was speaking on this PC, so "Answer out loud" puts it back
 * (without it the PC's own voice is written and the natural one takes over when it can).
 */
export type EasyCaps = {
  online: { openrouter: boolean; freellm: boolean };
  naturalVoice?: boolean;
  /** where answers came from the last time they were online: turning "Keep it on this PC" off goes back there */
  lastOnline?: "cloud" | "freellm";
};

export type EasyState = {
  private: EasySwitch | "custom";
  screen: EasySwitch;
  voice: EasySwitch | "custom";
  dictation: EasySwitch;
  tidy: EasySwitch | "custom";
  quality: EasyQuality | "custom";
  /** "" = automatic (the system language) */
  language: UiLanguage;
  startup: EasySwitch;
};

/** What a user action asks for, per control. */
export type EasyValue = { private: EasySwitch; screen: EasySwitch; voice: EasySwitch; dictation: EasySwitch; tidy: EasySwitch; quality: EasyQuality; language: UiLanguage; startup: EasySwitch };

/**
 * Writes to existing settings, per store. `voiceChosen: false` puts the voice back on automatic (the
 * natural voice speaks once it is on this PC); okfilow.js must accept it in a patch for that.
 */
export type EasyPatch = {
  okFilow?: Partial<EasySnapshot["okFilow"]> & { voiceChosen?: false };
  dictation?: Partial<EasySnapshot["dictation"]>;
  ui?: Partial<EasySnapshot["ui"]>;
  local?: Partial<EasySnapshot["local"]>;
};

/**
 * Why an action cannot be done: no online service is set up; this PC's graphics memory is too
 * small for Best quality; the disk is too full for it.
 */
export type EasyNeeds = "online-service" | "stronger-pc" | "disk";
export type EasyPatchResult = { ok: true; patch: EasyPatch } | { ok: false; needs: EasyNeeds };

/** What keeps "Keep it on this PC" from reading On while answers still come from this PC. */
export type EasyPrivateDifference = "voice-online" | "takes-ask" | "takes-online" | "translate-online";

export type EasyView = {
  state: EasyState;
  recommended: EasyState;
  /** controls that differ from the recommendation: "Reset to recommended" is shown when not empty */
  changed: EasyControl[];
  private: { differences: EasyPrivateDifference[]; /** false: this PC cannot answer questions by itself */ localAnswers: boolean; /** an online service is set up */ onlineReady: boolean };
  screen: { /** looking at the screen is slow on this PC (why the setup leaves it off); the user still chooses */ slow: boolean; /** on, with answers from online: a picture of the screen leaves this PC with each question */ leaves: boolean };
  tidy: { /** false while dictation is off: shown, not usable */ usable: boolean };
  quality: {
    /** every option the page shows, usable or not */
    options: EasyQuality[];
    /** Best quality is shown but cannot be chosen: the graphics memory is too small, or the disk is too full */
    bestBlocked: "stronger-pc" | "disk" | null;
    /** Best quality can be chosen here, with this said first: answers about the screen can wait while a talk is followed (a card under 12 GB) */
    bestNote: "shared-card" | null;
    /** the setup "Chosen for this PC" stands for */
    chosen: SetupProfileId;
    /** the setup in use now */
    active: SetupProfileId;
    /** the models that answer questions on this PC with the setup in use (a detail line, never a label) */
    helpers: string[];
    /** what the user can still fetch for the setup in use; each needs their click */
    downloads: EasyDownload[];
  };
  language: { /** set when listening was pinned to a language in Advanced */ listensIn: SpokenLang | null };
};

/**
 * One download the Easy page offers for answers on this PC. "helper": the small helper of the setup
 * in use. "best": the Best quality pair (the larger one, by choice). `preselected` marks the one
 * Filow suggests for this PC; `room` is false when the disk cannot take it with the spare left over.
 */
export type EasyDownload = { id: "helper" | "best"; models: SetupModel[]; gb: number; preselected: boolean; room: boolean };

const QUALITY_OF: Record<SetupPreference, EasyQuality | "custom"> = { auto: "auto", lite: "faster", advanced: "best", standard: "custom" };
const SETUP_OF: Record<EasyQuality, SetupPreference> = { auto: "auto", faster: "lite", best: "advanced" };
const sw = (on: boolean): EasySwitch => (on ? "on" : "off");

/**
 * What "auto" means for "Look at my screen" (the rule of apps/web/lib/buddy/sees.ts): online answers
 * always had the screen; on this PC the setup decides, and only a setup that reads the user's words
 * alone leaves it out.
 */
function seesByDefault(s: EasySnapshot, m: MachineInfo): boolean {
  return s.okFilow.provider !== "local" || resolveSetup(s.local.setup, m).choices.screenHelper.mode !== "text";
}

/** Whether the next question takes the screen with it: the user's own choice, else the default. */
function seesScreen(s: EasySnapshot, m: MachineInfo): boolean {
  return s.okFilow.seeScreen === "auto" ? seesByDefault(s, m) : s.okFilow.seeScreen === "on";
}

/**
 * Best quality in Easy (owner decision of 12 Nov 2026: the user decides). It can be chosen where
 * the hardware gets the advanced setup (recommendProfile, disk left aside: a usable card with 8 GB).
 * Under 12 GB the card cannot keep the point checker and the screen helper loaded together
 * (`waitsForDecisions`), so the choice comes with that said (`note`); from 12 GB there is nothing to say.
 */
function bestQuality(m: MachineInfo): { offered: boolean; blocked: "disk" | null; note: "shared-card" | null } {
  const offered = recommendProfile({ ...m, freeDiskGb: null }).profile === "advanced";
  const shared = offered && setupChoices("advanced", m).screenHelper.waitsForDecisions;
  return { offered, blocked: offered && recommendProfile(m).profile !== "advanced" ? "disk" : null, note: shared ? "shared-card" : null };
}

/**
 * The downloads for answers on this PC with the setup in use, never started without a click:
 * the setup's own helper when it is missing, and under Best quality the larger pair while it is
 * not here. Filow suggests the pair where the card holds everything at once (no `note`), the small
 * helper otherwise. Unknown when the list of installed models is (the browser without Ollama): none.
 */
function downloads(s: EasySnapshot, m: MachineInfo): EasyDownload[] {
  if (!m.installed) return [];
  const setup = resolveSetup(s.local.setup, m);
  const gb = (ms: SetupModel[]) => Math.round(ms.reduce((sum, x) => sum + x.downloadGb, 0) * 10) / 10;
  const room = (ms: SetupModel[]) => m.freeDiskGb === null || m.freeDiskGb === undefined || m.freeDiskGb >= gb(ms) + DOWNLOAD_SPARE_GB;
  const out: EasyDownload[] = [];
  const best = bestQuality(m);
  const pair = setup.active === "advanced" && best.offered ? bestQualityPairMissing(m) : [];
  const helper = missingModels(setup.choices, { ollama: m.installed, sherpa: true }).filter((x) => x.use === "screen");
  if (helper.length) out.push({ id: "helper", models: helper, gb: gb(helper), preselected: !pair.length || best.note !== null, room: room(helper) });
  if (pair.length) out.push({ id: "best", models: pair, gb: gb(pair), preselected: best.note === null, room: room(pair) });
  return out;
}

function privateDifferences(s: EasySnapshot): EasyPrivateDifference[] {
  const out: EasyPrivateDifference[] = [];
  if (s.okFilow.voice === "cloud") out.push("voice-online");
  if (s.local.startMode === "ask") out.push("takes-ask");
  if (s.local.startMode === "cloud") out.push("takes-online");
  if (s.local.translateWhere === "cloud") out.push("translate-online");
  return out;
}

/**
 * The eight controls as the settings stand.
 * - private: On when answers, voice, takes and translation all stay on this PC (takes on "auto" or
 *   "local": Auto never starts an online take). Off when answers come from an online service.
 *   Custom when answers stay here but something else may go online (see privateDifferences).
 * - screen: On when a picture goes with each question: the user's own choice, and until they chose,
 *   what the setup picked (off only where this PC answers from the user's words alone).
 * - voice: On for the PC's or the natural voice, Off for none, Custom for an online voice.
 * - tidy: On or Off when the three tidy-up settings agree, else Custom.
 * - quality: a pinned Balanced reads Custom; so does a pinned Best quality where Easy does not offer it.
 */
export function easyRead(s: EasySnapshot, m: MachineInfo): EasyState {
  const tidy = [s.dictation.cleanup, s.dictation.punctuate, s.dictation.removeFillers];
  const quality = QUALITY_OF[s.local.setup];
  return {
    private: s.okFilow.provider !== "local" ? "off" : privateDifferences(s).length ? "custom" : "on",
    screen: sw(seesScreen(s, m)),
    voice: s.okFilow.voice === "cloud" ? "custom" : sw(s.okFilow.voice !== "off"),
    dictation: sw(s.dictation.enabled),
    tidy: tidy.every(Boolean) ? "on" : tidy.some(Boolean) ? "custom" : "off",
    quality: quality === "best" && !bestQuality(m).offered ? "custom" : quality,
    language: s.ui.lang,
    startup: sw(s.ui.runAtStartup),
  };
}

/** A snapshot with a patch applied (what the settings hold once the writes are done). */
export function applyEasyPatch(s: EasySnapshot, p: EasyPatch): EasySnapshot {
  // voiceChosen is a write-only instruction to the desktop store, not part of what is read
  const { provider = s.okFilow.provider, voice = s.okFilow.voice, seeScreen = s.okFilow.seeScreen } = p.okFilow ?? {};
  return { ...s, okFilow: { provider, voice, seeScreen }, dictation: { ...s.dictation, ...p.dictation }, ui: { ...s.ui, ...p.ui }, local: { ...s.local, ...p.local } };
}

/** Drop the writes that would not change anything, and the stores left empty. */
function onlyChanges(s: EasySnapshot, p: EasyPatch): EasyPatch {
  const out: EasyPatch = {};
  for (const store of ["okFilow", "dictation", "ui", "local"] as const) {
    const now = s[store] as Record<string, unknown>;
    const kept = Object.entries(p[store] ?? {}).filter(([k, v]) => (k === "voiceChosen" ? true : now[k] !== v));
    // voiceChosen alone changes nothing the user asked for: it only rides along with a voice write
    if (kept.some(([k]) => k !== "voiceChosen")) (out as Record<string, unknown>)[store] = Object.fromEntries(kept);
  }
  return out;
}

/**
 * The writes for one user action. A control that already reads as the asked value gets no write, so
 * nothing the user set in Advanced changes under an unchanged control. Never touches consent, keys or
 * any setting without an Easy control; turning "Keep it on this PC" off only names where answers may
 * come from: the first-send notice and the sign that something leaves stay where they are.
 */
export function easyPatch<C extends EasyControl>(control: C, value: EasyValue[C], s: EasySnapshot, m: MachineInfo, caps: EasyCaps): EasyPatchResult {
  if ((easyRead(s, m)[control] as string) === value) return { ok: true, patch: {} };
  const done = (patch: EasyPatch): EasyPatchResult => ({ ok: true, patch: onlyChanges(s, patch) });
  const on = value === "on";
  // back to the voice on this PC: the natural one where it was speaking, else the PC's own; never "chosen",
  // so the natural voice still takes over once it is on this PC
  const localVoice = { voice: caps.naturalVoice ? "natural" : "system", voiceChosen: false } as const;
  switch (control as EasyControl) {
    case "private": {
      if (on) {
        return done({
          okFilow: { provider: "local", ...(s.okFilow.voice === "cloud" ? localVoice : {}) },
          local: { startMode: s.local.startMode === "local" ? "local" : "auto", translateWhere: "local" },
        });
      }
      // the service the user had before, while it is still set up; else the one that is
      const ready = { cloud: caps.online.openrouter, freellm: caps.online.freellm };
      const provider = caps.lastOnline && ready[caps.lastOnline] ? caps.lastOnline : ready.cloud ? "cloud" : ready.freellm ? "freellm" : null;
      if (!provider) return { ok: false, needs: "online-service" };
      // "Look at my screen" not chosen yet and reading off (this PC answers from the words alone): it
      // stays off. Online answers would take the screen by default, and one click here must not
      // start sending pictures of the screen; the user turns that on with its own switch.
      const keepScreenOff = !seesScreen(s, m);
      return done({ okFilow: { provider, ...(keepScreenOff ? { seeScreen: "off" as const } : {}) } });
    }
    case "screen":
      // the user's own choice, written as such: it holds when the setup or where answers come from changes later
      return done({ okFilow: { seeScreen: on ? "on" : "off" } });
    case "voice":
      return done({ okFilow: on ? localVoice : { voice: "off" } });
    case "dictation":
      return done({ dictation: { enabled: on } });
    case "tidy":
      return done({ dictation: { cleanup: on, punctuate: on, removeFillers: on } });
    case "quality": {
      if (value === "best") {
        const best = bestQuality(m);
        if (!best.offered) return { ok: false, needs: "stronger-pc" };
        if (best.blocked) return { ok: false, needs: "disk" };
      }
      return done({ local: { setup: SETUP_OF[value as EasyQuality] } });
    }
    case "language":
      return done({ ui: { lang: value as UiLanguage } });
    case "startup":
      return done({ ui: { runAtStartup: on } });
  }
}

/**
 * What Filow chooses for this PC: everything stays on it, the picture of the screen where the PC is
 * fast enough for it, voice, dictation and tidy-up on, the setup picked for the machine, the system
 * language, and no start with Windows. The same on every machine except "Look at my screen".
 */
export function easyRecommended(m: MachineInfo): EasyState {
  const pictures = setupChoices(recommendProfile(m).profile, m).screenHelper.mode !== "text";
  return { private: "on", screen: sw(pictures), voice: "on", dictation: "on", tidy: "on", quality: "auto", language: "", startup: "off" };
}

/**
 * "Reset to recommended": the writes that put all eight controls back, and the controls that will
 * change (the page lists them before doing it). Consent, keys and Advanced-only settings are not touched.
 * `controls`: the ones the page shows; a control it does not show is neither written nor listed.
 */
export function easyReset(s: EasySnapshot, m: MachineInfo, caps: EasyCaps, controls: readonly EasyControl[] = EASY_CONTROLS): { patch: EasyPatch; changes: EasyControl[] } {
  const want = easyRecommended(m);
  const patch: EasyPatch = {};
  let now = s;
  for (const control of EASY_CONTROLS) {
    if (!controls.includes(control)) continue;
    // the screen choice goes back to "auto" (the setup decides again), whatever the switch reads now
    const step: EasyPatchResult = control === "screen" ? { ok: true, patch: onlyChanges(now, { okFilow: { seeScreen: "auto" } }) } : easyPatch(control, want[control] as never, now, m, caps);
    if (!step.ok) continue;
    for (const store of ["okFilow", "dictation", "ui", "local"] as const) if (step.patch[store]) (patch as Record<string, unknown>)[store] = { ...patch[store], ...step.patch[store] };
    now = applyEasyPatch(now, step.patch);
  }
  // what the user will see change: one write can move two controls (an online voice shows on two)
  const before = easyRead(s, m), after = easyRead(now, m);
  const changes = EASY_CONTROLS.filter((c) => controls.includes(c) && (before[c] !== after[c] || (c === "screen" && s.okFilow.seeScreen !== now.okFilow.seeScreen)));
  return { patch, changes };
}

/** Everything the Easy page shows: the state, the recommendation, and what each control can do here. */
export function easyView(s: EasySnapshot, m: MachineInfo, caps: EasyCaps, controls: readonly EasyControl[] = EASY_CONTROLS): EasyView {
  const state = easyRead(s, m);
  const recommended = easyRecommended(m);
  const setup = resolveSetup(s.local.setup, m);
  const best = bestQuality(m);
  const options: EasyQuality[] = ["auto"];
  if (setup.recommended !== "lite" || state.quality === "faster") options.unshift("faster");
  // Best quality is always shown where it differs from "Chosen for this PC": the user decides, and
  // where this PC cannot carry it the option stays visible with the reason (bestBlocked)
  if (setup.recommended !== "advanced" || state.quality === "best") options.push("best");
  const helper = setup.choices.screenHelper;
  return {
    state,
    recommended,
    changed: easyReset(s, m, caps, controls).changes,
    private: { differences: s.okFilow.provider === "local" ? privateDifferences(s) : [], localAnswers: setup.choices.screenHelper.mode !== "none", onlineReady: caps.online.openrouter || caps.online.freellm },
    screen: { slow: s.okFilow.provider === "local" && helper.mode === "text", leaves: state.screen === "on" && s.okFilow.provider !== "local" },
    tidy: { usable: s.dictation.enabled },
    quality: {
      options,
      bestBlocked: !best.offered ? "stronger-pc" : best.blocked,
      bestNote: best.note,
      chosen: setup.recommended,
      active: setup.active,
      helpers: [helper.model, helper.pointer].filter((x): x is string => Boolean(x)),
      downloads: downloads(s, m),
    },
    language: { listensIn: s.speechLanguage === "auto" ? null : s.speechLanguage },
  };
}
