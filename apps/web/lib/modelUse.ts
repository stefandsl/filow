// "Installed" says a model takes disk space; "in use" says a feature would pick it with the current
// settings. This file puts the answers together for the settings page. Nothing is guessed here: the
// desktop app reports what its own selection code picks (apps/desktop/model-use.js), the plan is the
// one a take starts with (lib/plan.ts), and the server names the Ollama models its own pickers return
// (app/api/local/status). What is left for the page is the user's switches: a feature set to the
// cloud uses no local model.
import { LANG_LABELS, type I18nKey, type Lang } from "@filow/core";

export type UseId = "tracking" | "questions" | "dictation" | "voice" | "cleanup" | "punctuation" | "decision" | "generate" | "translate" | "okfilow" | "whiteboard" | "gate";
export type ModelUseItem = { use: UseId; language?: string };

/** One row of the desktop app's list (window.filow.models.status()). */
/** `downloading`: this model's own download is in flight (its percent and Stop are where it was started). */
export type DeviceModel = { id: string; kind: "speech" | "voice" | "cleanup" | "punctuation"; name: string; installed: boolean; bytes: number; uses: ModelUseItem[]; loaded: boolean; downloading?: boolean };
export type DeviceModels = { models: DeviceModel[]; downloading: string[] };

export type UseContext = {
  /** The plan a take would start with now; null while it is not known. */
  plan: { stt: { backend: string | null }; decision: { provider: string | null }; generate: { provider: string; model: string | null } } | null;
  /** How a take starts: "cloud" sends the audio and the decisions out. */
  startMode: "ask" | "auto" | "cloud" | "local";
  /** The decision provider pinned in Settings; "" follows the plan. */
  decisionPref: string;
  /** OK Filow as the desktop app reports it; null in the browser. */
  okFilow: { enabled: boolean; provider: string; offline: boolean } | null;
  /** Where the editor's Translate runs. */
  translateWhere: "local" | "cloud";
  gateMode: "on" | "off";
  /** The Whisper model picked for speech inside the app. */
  whisperModel: string;
  /**
   * The Ollama models the server's own pickers return (GET /api/local/status, `picks`), with the
   * user's per-task choices applied. `generate` and `whiteboard` are there only when the user chose a
   * model for them (null: it runs on his own server, not on this PC).
   */
  picks: { decision: string; translate: string | null; okfilow: string[]; generate?: string | null; whiteboard?: string | null } | null;
};

/** Ollama reads a name without a tag as ":latest"; another tag of the same family is another model. */
const tagged = (name: string) => (name.includes(":") ? name : `${name}:latest`);
const sameModel = (row: string, picked: string | null | undefined) => Boolean(picked) && tagged(row) === tagged(picked!);

/** A take in cloud mode keeps nothing on this computer: no local model follows the talk or ticks the points. */
const localTake = (ctx: UseContext) => ctx.startMode !== "cloud";

/** The rows Settings shows: everything on disk except a download in flight (it is listed when it is done, or when it was left unfinished). */
export function listedModels(data: DeviceModels): DeviceModel[] {
  return data.models.filter((m) => m.installed || !m.downloading);
}

/** A model from the desktop app's list: its uses, without "following a talk" when a take would not use it. */
export function deviceUses(model: Pick<DeviceModel, "uses">, ctx: UseContext): ModelUseItem[] {
  const followsTalk = localTake(ctx) && ctx.plan?.stt.backend === "sherpa";
  return model.uses.filter((u) => u.use !== "tracking" || followsTalk);
}

/** An Ollama model of Filow's catalogue: every feature that would call it now. */
export function ollamaUses(name: string, ctx: UseContext): ModelUseItem[] {
  const uses: ModelUseItem[] = [];
  const provider = ctx.decisionPref || ctx.plan?.decision.provider || "";
  if (localTake(ctx) && provider === "clef-local" && sameModel(name, ctx.picks?.decision)) uses.push({ use: "decision" });
  const generate = ctx.picks && "generate" in ctx.picks ? ctx.picks.generate : ctx.plan?.generate.model;
  if (ctx.plan?.generate.provider === "ollama" && sameModel(name, generate)) uses.push({ use: "generate" });
  if (ctx.translateWhere === "local" && sameModel(name, ctx.picks?.translate)) uses.push({ use: "translate" });
  if (ctx.okFilow?.enabled && ctx.okFilow.provider === "local" && (ctx.picks?.okfilow ?? []).some((m) => sameModel(name, m))) uses.push({ use: "okfilow" });
  if (ctx.okFilow?.enabled && ctx.okFilow.provider === "local" && sameModel(name, ctx.picks?.whiteboard)) uses.push({ use: "whiteboard" });
  return uses;
}

/** A model that runs inside the app's own page (Whisper, the pre-filter). */
export function browserUses(model: { name: string; kind: "whisper" | "gate" }, ctx: UseContext): ModelUseItem[] {
  if (model.kind === "gate") return ctx.gateMode === "on" ? [{ use: "gate" }] : [];
  return localTake(ctx) && ctx.plan?.stt.backend === "whisper" && ctx.whisperModel === model.name ? [{ use: "tracking" }] : [];
}

type T = (key: I18nKey, vars?: Record<string, string | number>) => string;

/** "following a talk, dictation (Italiano)": the uses in the user's words; the language only where one is set. */
export function usesText(uses: ModelUseItem[], t: T): string {
  return uses
    .map((u) => {
      const use = t(`use.${u.use}` as I18nKey);
      const language = u.language && u.language in LANG_LABELS && u.use !== "cleanup" ? LANG_LABELS[u.language as Lang] : "";
      return language ? t("use.withLanguage", { use, language }) : use;
    })
    .join(", ");
}

/** 475 MB, 1.2 GB: whole megabytes under a gigabyte, one decimal above. */
export function sizeText(bytes: number, t: T): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1000 ? t("size.mb", { n: Math.max(1, Math.round(mb)) }) : t("size.gb", { n: (mb / 1024).toFixed(1) });
}

/**
 * The one question before a delete: the model's name and size, and when it is in use, for what and
 * what happens next (which feature falls back or stops).
 */
export function deleteQuestion(model: { name: string; size: string; uses: ModelUseItem[]; effect: "speech" | "voice" | "cleanup" | "punctuation" | "ollama" | "browser" }, t: T): string {
  const question = t("settings.deleteModelConfirm", { name: model.name, size: model.size });
  if (model.uses.length === 0) return question;
  return `${question}\n\n${t("settings.deleteModelInUse", { what: usesText(model.uses, t) })} ${t(`deleteEffect.${model.effect}` as I18nKey)}`;
}
