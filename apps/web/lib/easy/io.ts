// The Easy settings page reads and writes the settings that already exist (packages/core/src/easy.ts
// holds the mapping and stores nothing). This file is the glue: what each store says now becomes one
// snapshot, and a patch goes back to each store through its own writer.
import { EASY_CONTROLS, type EasyControl, type EasyPatch, type EasySnapshot, type SpokenLang, type UiLanguage } from "@filow/core";
import type { DictationStatus, OkFilowStatus } from "@/lib/buddy/bridge";

/** What each store says now; null where the store is not there (the browser has no desktop app behind it). */
export type EasySources = {
  okFilow: Pick<OkFilowStatus, "provider" | "voice" | "seeScreen"> | null;
  dictation: Pick<DictationStatus, "enabled" | "cleanup" | "punctuate" | "removeFillers"> | null;
  ui: EasySnapshot["ui"];
  local: EasySnapshot["local"];
  speechLanguage: "auto" | SpokenLang;
};

/**
 * One snapshot for easy.ts. A store that is not there reads as a fresh profile does, so its controls
 * read as recommended (the page hides them: see easyVisible). A desktop build older than a field
 * (seeScreen, punctuate) reads that field as its default.
 */
export function easySnapshot(src: EasySources): EasySnapshot {
  const o = src.okFilow, d = src.dictation;
  return {
    okFilow: { provider: o?.provider ?? "local", voice: o?.voice ?? "system", seeScreen: o?.seeScreen ?? "auto" },
    dictation: { enabled: d?.enabled ?? true, cleanup: d?.cleanup ?? true, punctuate: d?.punctuate ?? true, removeFillers: d?.removeFillers ?? true },
    ui: src.ui,
    local: src.local,
    speechLanguage: src.speechLanguage,
  };
}

/** What the page can write to. The desktop writers are absent in the browser. */
export type EasyIo = {
  okFilow?: (patch: NonNullable<EasyPatch["okFilow"]>) => Promise<unknown>;
  dictation?: (patch: NonNullable<EasyPatch["dictation"]>) => Promise<unknown>;
  /** resolves false when the system refused (startup blocked in the system's own settings) */
  startup?: (on: boolean) => Promise<boolean>;
  lang: (lang: UiLanguage) => void;
  setup: (p: EasySnapshot["local"]["setup"]) => void;
  startMode: (m: EasySnapshot["local"]["startMode"]) => void;
  translateWhere: (w: EasySnapshot["local"]["translateWhere"]) => void;
};

/**
 * The controls the page shows: a control whose store is not there is left out, never drawn as a dead
 * switch. "Keep it on this PC", "Look at my screen" and "Answer out loud" live in the desktop app's
 * OK Filow settings, the two dictation controls in its dictation settings, "Start with Windows" in
 * the system; "Speed or quality" and "Language" work everywhere.
 */
export function easyVisible(io: Pick<EasyIo, "okFilow" | "dictation" | "startup">): EasyControl[] {
  const needs: Partial<Record<EasyControl, unknown>> = { private: io.okFilow, screen: io.okFilow, voice: io.okFilow, dictation: io.dictation, tidy: io.dictation, startup: io.startup };
  return EASY_CONTROLS.filter((c) => !(c in needs) || Boolean(needs[c]));
}

/**
 * Sends a patch to the stores it names. Each store gets one write with only the keys of the patch.
 * Resolves false when a store named by the patch is not there, a write threw, or the system refused
 * the startup change; the page then reads everything again and shows what is really stored.
 */
export async function writeEasyPatch(patch: EasyPatch, io: EasyIo): Promise<boolean> {
  let ok = true;
  try {
    if (patch.okFilow) {
      if (io.okFilow) await io.okFilow(patch.okFilow);
      else ok = false;
    }
    if (patch.dictation) {
      if (io.dictation) await io.dictation(patch.dictation);
      else ok = false;
    }
    if (patch.ui?.lang !== undefined) io.lang(patch.ui.lang);
    if (patch.ui?.runAtStartup !== undefined) {
      if (!io.startup || !(await io.startup(patch.ui.runAtStartup))) ok = false;
    }
    if (patch.local?.setup !== undefined) io.setup(patch.local.setup);
    if (patch.local?.startMode !== undefined) io.startMode(patch.local.startMode);
    if (patch.local?.translateWhere !== undefined) io.translateWhere(patch.local.translateWhere);
  } catch {
    ok = false;
  }
  return ok;
}

/**
 * The address that starts a download in Advanced settings: its model list pulls the names after
 * `auto=` one after the other, shows the progress and has the Stop button. The click on the Easy
 * page is the user's yes; nothing opens this address by itself.
 */
export function downloadHref(names: string[]): string {
  return `/settings/local?auto=${names.map(encodeURIComponent).join(",")}#models`;
}
