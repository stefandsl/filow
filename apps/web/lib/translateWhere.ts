// Where the editor's Translate runs: on this PC (the default) or in the cloud the user picked for
// scripts. The choice is the user's and is remembered; it never changes by itself. When the local
// path cannot run, the editor says why and offers the two ways on (use the cloud, open Local models).
import type { I18nKey } from "@filow/core";

export type TranslateWhere = "local" | "cloud";
/** What GET /api/script/translate answers. */
export type TranslateState = {
  local: { ok: true; model: string } | { ok: false; reason: "ollama_down" | "no_model" };
  cloud: "openrouter" | "freellm";
  offline: boolean;
  /** set when Ollama runs on another computer the user configured: "on this PC" would not be true */
  ollamaHost?: string | null;
};
export type LocalUnavailable = "ollama_down" | "no_model" | "too_slow" | "failed";

const KEY = "filow.translate.where";
type Store = Pick<Storage, "getItem" | "setItem">;

/** The remembered choice; "local" until the user picks the cloud. */
export function readTranslateWhere(store: Store | null | undefined): TranslateWhere {
  try {
    return store?.getItem(KEY) === "cloud" ? "cloud" : "local";
  } catch {
    return "local";
  }
}

export function saveTranslateWhere(store: Store | null | undefined, where: TranslateWhere): void {
  try {
    store?.setItem(KEY, where);
  } catch {
    /* private mode: the choice lasts as long as the editor */
  }
}

/** The model Local models offers for translation, with its one-time download (docs/TRANSLATE-LOCAL.md). */
export const TRANSLATE_MODEL_TO_GET = { name: "gemma4:e2b", downloadGb: 4.3 };

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/** Why the local path did not translate, in the user's language. */
export function localUnavailableText(reason: string, t: Translate, error = ""): string {
  if (reason === "ollama_down") return t("editor.localDown");
  if (reason === "no_model") return t("editor.localNoModel", { model: TRANSLATE_MODEL_TO_GET.name, gb: TRANSLATE_MODEL_TO_GET.downloadGb });
  if (reason === "too_slow") return t("editor.localSlow");
  return t("editor.localFailed", { error });
}

/**
 * The line under the controls before the user presses Translate: where the text will be worked on.
 * `blocked`: pressing Translate now could not work (shown with the two ways on); the choice stays
 * what the user set.
 */
export function whereHint(where: TranslateWhere, state: TranslateState | null, who: string, t: Translate): { text: string; blocked: boolean } {
  if (where === "cloud") return state?.offline ? { text: t("editor.whereCloudOffline"), blocked: true } : { text: t("editor.whereCloudHint", { who }), blocked: false };
  if (!state) return { text: t("editor.whereLocalChecking"), blocked: false };
  if (state.local.ok && state.ollamaHost) return { text: t("editor.whereOwnServerHint", { model: state.local.model, host: state.ollamaHost }), blocked: false };
  if (state.local.ok) return { text: t("editor.whereLocalHint", { model: state.local.model }), blocked: false };
  return { text: localUnavailableText(state.local.reason, t), blocked: true };
}
