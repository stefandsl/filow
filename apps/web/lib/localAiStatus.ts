// What Settings > Local models says about the Ollama install and start (the desktop shell's
// localai.js reports a state and, on failure, a code; the words are chosen here, in the user's language).
import type { I18nKey } from "@filow/core";
import type { LocalAiStatus } from "@/lib/sessionUrl";

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/** The failures localai.js names (installOllama); each has its own sentence under settings.ai.err.*. */
export const LOCAL_AI_ERROR_CODES = ["download_failed", "not_signed", "installer_failed", "exe_missing", "start_exited", "start_timeout", "unexpected"] as const;

/** Failures the user cannot fix alone: the report carries the reason (exit code, the end of Ollama's log). */
const NEEDS_REPORT = new Set<string>(["installer_failed", "exe_missing", "start_exited", "start_timeout", "unexpected"]);

const known = (code: string | undefined): code is (typeof LOCAL_AI_ERROR_CODES)[number] => (LOCAL_AI_ERROR_CODES as readonly string[]).includes(code ?? "");

/**
 * The line shown next to "Install Ollama automatically". A failure with a code gets its own sentence;
 * one without a code already is a sentence in the user's language (the offline notice) and is shown
 * as it is; a code this page does not know gets the general sentence, never the raw English reason.
 */
export function localAiText(s: LocalAiStatus, t: Translate): string {
  if (s.state === "idle") return "";
  if (s.state !== "error") return t(`settings.ai.${s.state}`, { pct: s.pct, v: s.version });
  if (!s.code) return s.error || t("settings.ai.err.unexpected");
  return t(`settings.ai.err.${known(s.code) ? s.code : "unexpected"}`);
}

/** Whether "Report a problem" belongs next to the failure. */
export function localAiNeedsReport(s: LocalAiStatus | null): boolean {
  return Boolean(s && s.state === "error" && s.code && (NEEDS_REPORT.has(s.code) || !known(s.code)));
}

/**
 * A download that needs Ollama waits for the desktop shell to have it running. What to do with the
 * status just read: "ask" the shell to install and start it, "wait", or stop ("ready" / "failed").
 * `fresh`: this status is the end of a run we asked for or watched, not a result from before.
 * A run on its way is waited for. A start check that ended with nothing installed (idle) and a result
 * from before (ready or error while Ollama does not answer) make us ask, once.
 */
export function localAiEnsureStep(s: LocalAiStatus, asked: boolean, fresh: boolean): "ask" | "wait" | "ready" | "failed" {
  if (localAiBusy(s)) return "wait";
  if (s.state === "idle") return asked ? "failed" : "ask";
  if (!fresh && !asked) return "ask";
  return s.state === "ready" ? "ready" : "failed"; // error or manual
}

/** A status that is still on its way: the install button waits and nothing is offered yet. */
export function localAiBusy(s: LocalAiStatus | null): boolean {
  return Boolean(s && ["checking", "downloading", "installing", "starting"].includes(s.state));
}
