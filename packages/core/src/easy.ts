// Easy settings: eight plain controls in front of the detailed settings. Pure and without a store of
// its own: every control is read from the settings that already exist and written back as a patch
// to them, so the Easy page and the Advanced page can never disagree. Which setup a machine gets
// comes from profile.ts (recommendProfile, setupChoices); no hardware rule is repeated here.
import type { SpokenLang } from "./spoken";
import type { UiLanguage } from "./ui-preferences";
import { recommendProfile, resolveSetup, setupChoices, type MachineInfo, type SetupPreference, type SetupProfileId } from "./profile";

/** The eight controls, in the order the page shows them. */
export const EASY_CONTROLS = ["private", "screen", "voice", "dictation", "tidy", "quality", "language", "startup"] as const;
export type EasyControl = (typeof EASY_CONTROLS)[number];

export type EasySwitch = "on" | "off";
export type EasyQuality = "auto" | "faster" | "best";

/**
 * What the controls read. Each field is an existing setting:
 * - okFilow: settings.json `okFilow.*` (apps/desktop/okfilow.js). `screen` is the "Look at my screen"
 *   field another track adds there ("auto" follows the setup, "off" sends no picture); until it
 *   exists the caller passes "auto".
 * - dictation: settings.json `dictation.*` (apps/desktop/dictation-core.js).
 * - ui: interface language and start with Windows (ui-preferences.ts).
 * - local: the three choices kept in the page's localStorage (apps/web/lib/prefs.ts, translateWhere.ts).
 * - speechLanguage: read only; the Language control never writes it.
 */
export type EasySnapshot = {
  okFilow: { provider: "local" | "cloud" | "freellm"; voice: "system" | "natural" | "cloud" | "off"; screen: "auto" | "off" };
  dictation: { enabled: boolean; cleanup: boolean; punctuate: boolean; removeFillers: boolean };
  ui: { lang: UiLanguage; runAtStartup: boolean };
  local: { setup: SetupPreference; startMode: "ask" | "auto" | "cloud" | "local"; translateWhere: "local" | "cloud" };
  speechLanguage: "auto" | SpokenLang;
};

/** Which online services the user has set up: turning "Keep it on this PC" off needs one. */
export type EasyCaps = { online: { openrouter: boolean; freellm: boolean } };

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
 * Why an action cannot be done: no online service is set up; this PC answers from text because
 * pictures are too slow here; this PC is not strong enough for Best quality; the disk is too full for it.
 */
export type EasyNeeds = "online-service" | "pictures" | "stronger-pc" | "disk";
export type EasyPatchResult = { ok: true; patch: EasyPatch } | { ok: false; needs: EasyNeeds };

/** What keeps "Keep it on this PC" from reading On while answers still come from this PC. */
export type EasyPrivateDifference = "voice-online" | "takes-ask" | "takes-online" | "translate-online";

export type EasyView = {
  state: EasyState;
  recommended: EasyState;
  /** controls that differ from the recommendation: "Reset to recommended" is shown when not empty */
  changed: EasyControl[];
  private: { differences: EasyPrivateDifference[]; /** false: this PC cannot answer questions by itself */ localAnswers: boolean; /** an online service is set up */ onlineReady: boolean };
  screen: { /** false: pictures are too slow on this PC and answers stay here, so the switch is shown off and disabled */ available: boolean };
  tidy: { /** false while dictation is off: shown, not usable */ usable: boolean };
  quality: { options: EasyQuality[]; /** "disk": Best quality is shown but needs free disk first */ bestBlocked: "disk" | null; /** the setup "Chosen for this PC" stands for */ chosen: SetupProfileId; /** the setup in use now */ active: SetupProfileId };
  language: { /** set when listening was pinned to a language in Advanced */ listensIn: SpokenLang | null };
};

const QUALITY_OF: Record<SetupPreference, EasyQuality | "custom"> = { auto: "auto", lite: "faster", advanced: "best", standard: "custom" };
const SETUP_OF: Record<EasyQuality, SetupPreference> = { auto: "auto", faster: "lite", best: "advanced" };
const sw = (on: boolean): EasySwitch => (on ? "on" : "off");

/** Answers can use the picture of the screen: always online; on this PC only when the setup reads pictures. */
function picturesAvailable(s: EasySnapshot, m: MachineInfo): boolean {
  return s.okFilow.provider !== "local" || resolveSetup(s.local.setup, m).choices.screenHelper.mode === "picture";
}

/**
 * Best quality in Easy: the machine's hardware gets the advanced setup (recommendProfile, disk left
 * aside) and its card keeps the point checker and the screen helper loaded together (12 GB, the
 * `waitsForDecisions` rule of setupChoices). Under that, answers about the screen can wait minutes
 * behind the point checker, so Easy does not offer it; Advanced keeps today's rule.
 */
function bestQuality(m: MachineInfo): { offered: boolean; blocked: "disk" | null } {
  const hardware = recommendProfile({ ...m, freeDiskGb: null }).profile === "advanced";
  const offered = hardware && !setupChoices("advanced", m).screenHelper.waitsForDecisions;
  return { offered, blocked: offered && recommendProfile(m).profile !== "advanced" ? "disk" : null };
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
 * - screen: On when a picture goes with each question; Off when the user turned it off, or when
 *   pictures are too slow on this PC and answers stay here.
 * - voice: On for the PC's or the natural voice, Off for none, Custom for an online voice.
 * - tidy: On or Off when the three tidy-up settings agree, else Custom.
 * - quality: a pinned Balanced reads Custom; so does a pinned Best quality where Easy does not offer it.
 */
export function easyRead(s: EasySnapshot, m: MachineInfo): EasyState {
  const tidy = [s.dictation.cleanup, s.dictation.punctuate, s.dictation.removeFillers];
  const quality = QUALITY_OF[s.local.setup];
  return {
    private: s.okFilow.provider !== "local" ? "off" : privateDifferences(s).length ? "custom" : "on",
    screen: sw(s.okFilow.screen !== "off" && picturesAvailable(s, m)),
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
  const { provider = s.okFilow.provider, voice = s.okFilow.voice, screen = s.okFilow.screen } = p.okFilow ?? {};
  return { ...s, okFilow: { provider, voice, screen }, dictation: { ...s.dictation, ...p.dictation }, ui: { ...s.ui, ...p.ui }, local: { ...s.local, ...p.local } };
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
  switch (control as EasyControl) {
    case "private": {
      if (on) {
        return done({
          okFilow: { provider: "local", ...(s.okFilow.voice === "cloud" ? { voice: "system", voiceChosen: false } : {}) },
          local: { startMode: s.local.startMode === "local" ? "local" : "auto", translateWhere: "local" },
        });
      }
      const provider = caps.online.openrouter ? "cloud" : caps.online.freellm ? "freellm" : null;
      return provider ? done({ okFilow: { provider } }) : { ok: false, needs: "online-service" };
    }
    case "screen":
      if (on && !picturesAvailable({ ...s, okFilow: { ...s.okFilow, screen: "auto" } }, m)) return { ok: false, needs: "pictures" };
      return done({ okFilow: { screen: on ? "auto" : "off" } });
    case "voice":
      return done({ okFilow: on ? { voice: "system", voiceChosen: false } : { voice: "off" } });
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
  const pictures = setupChoices(recommendProfile(m).profile, m).screenHelper.mode === "picture";
  return { private: "on", screen: sw(pictures), voice: "on", dictation: "on", tidy: "on", quality: "auto", language: "", startup: "off" };
}

/**
 * "Reset to recommended": the writes that put all eight controls back, and the controls that will
 * change (the page lists them before doing it). Consent, keys and Advanced-only settings are not touched.
 */
export function easyReset(s: EasySnapshot, m: MachineInfo, caps: EasyCaps): { patch: EasyPatch; changes: EasyControl[] } {
  const want = easyRecommended(m);
  const patch: EasyPatch = {};
  let now = s;
  for (const control of EASY_CONTROLS) {
    // the stored screen choice goes back to "auto" even where the switch reads off because the PC is too slow
    const step: EasyPatchResult = control === "screen" ? { ok: true, patch: onlyChanges(now, { okFilow: { screen: "auto" } }) } : easyPatch(control, want[control] as never, now, m, caps);
    if (!step.ok) continue;
    for (const store of ["okFilow", "dictation", "ui", "local"] as const) if (step.patch[store]) (patch as Record<string, unknown>)[store] = { ...patch[store], ...step.patch[store] };
    now = applyEasyPatch(now, step.patch);
  }
  // what the user will see change: one write can move two controls (an online voice shows on two)
  const before = easyRead(s, m), after = easyRead(now, m);
  const changes = EASY_CONTROLS.filter((c) => before[c] !== after[c] || (c === "screen" && s.okFilow.screen !== now.okFilow.screen));
  return { patch, changes };
}

/** Everything the Easy page shows: the state, the recommendation, and what each control can do here. */
export function easyView(s: EasySnapshot, m: MachineInfo, caps: EasyCaps): EasyView {
  const state = easyRead(s, m);
  const recommended = easyRecommended(m);
  const setup = resolveSetup(s.local.setup, m);
  const best = bestQuality(m);
  const options: EasyQuality[] = ["auto"];
  if (setup.recommended !== "lite" || state.quality === "faster") options.unshift("faster");
  if (best.offered && (setup.recommended !== "advanced" || state.quality === "best")) options.push("best");
  return {
    state,
    recommended,
    changed: easyReset(s, m, caps).changes,
    private: { differences: s.okFilow.provider === "local" ? privateDifferences(s) : [], localAnswers: setup.choices.screenHelper.mode !== "none", onlineReady: caps.online.openrouter || caps.online.freellm },
    screen: { available: picturesAvailable(s, m) },
    tidy: { usable: s.dictation.enabled },
    quality: { options, bestBlocked: best.blocked, chosen: setup.recommended, active: setup.active },
    language: { listensIn: s.speechLanguage === "auto" ? null : s.speechLanguage },
  };
}
