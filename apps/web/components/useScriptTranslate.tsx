"use client";
// The editor's Translate: on this PC by default (a local model through Ollama, nothing leaves the
// computer, no notice), or in the cloud when the user picks it (the outbound notice, as before).
// The user sees where it will run before pressing, and the choice is remembered. One is never used
// instead of the other: when the local path cannot run, the editor says why and offers the cloud
// and Local models; pressing "Use the cloud" is the user's choice and shows the notice.
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@filow/ui";
import { joinNames, localNames } from "@/lib/buddy/outbound";
import { localizeFreeLlmError } from "@/lib/freellm";
import { getLang } from "@/lib/prefs";
import { desktopBridge } from "@/lib/sessionUrl";
import { localUnavailableText, readTranslateWhere, saveTranslateWhere, whereHint, type TranslateState, type TranslateWhere } from "@/lib/translateWhere";
import { useOkfText } from "./PageOutbound";
import { pageOutbound } from "./usePageOutbound";
import { engineHeaders, ensureEngineToken } from "./useSession";

type Answer = {
  text?: string;
  model?: string;
  structureKept?: boolean;
  expected?: { points: number };
  got?: { sections: number; points: number };
  untranslated?: number;
  untranslatedSections?: number[];
  unavailable?: string;
  error?: string;
};

const LANGS = [["en", "English"], ["it", "Italiano"], ["ru", "Русский"], ["ro", "Română"], ["ja", "日本語"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"]];

/** How long the editor waits for an Ollama the desktop shell is starting before it says it is not running. */
const START_WAIT_MS = 45_000;

export function useScriptTranslate(text: string, setText: (text: string) => void) {
  const t = useT();
  const okt = useOkfText();
  const [to, setTo] = useState("en");
  const [where, setWhere] = useState<TranslateWhere>("local");
  const [state, setState] = useState<TranslateState | null>(null);
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** the local path was tried and could not run: the reason stays on screen with the two ways on */
  const [stuck, setStuck] = useState<string | null>(null);
  const alive = useRef(true);

  const check = useCallback(async (): Promise<TranslateState | null> => {
    try {
      await ensureEngineToken();
      const res = await fetch("/api/script/translate", { headers: engineHeaders(), cache: "no-store" });
      if (!res.ok) return null;
      const s = (await res.json()) as TranslateState;
      if (alive.current) setState(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    setWhere(readTranslateWhere(typeof window === "undefined" ? null : window.localStorage));
    void check();
    void pageOutbound()
      .recipients()
      .then((r) => {
        if (r && alive.current) setWho(joinNames(localNames(r.script.names, okt("freeName")), okt("outAnd")));
      });
    return () => {
      alive.current = false;
    };
    // once, when the editor opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (next: TranslateWhere) => {
    setWhere(next);
    saveTranslateWhere(window.localStorage, next);
    setStuck(null);
    setNote(null);
    if (next === "local") void check();
  };

  const show = (j: Answer, local: boolean) => {
    if (!j.text) return;
    setText(j.text);
    const vars = { model: j.model ?? "", sections: j.got?.sections ?? 0, points: j.got?.points ?? 0 };
    if (!j.structureKept) setNote(t("editor.translateMismatch", { got: j.got?.points ?? 0, expected: j.expected?.points ?? 0 }));
    else if (j.untranslated) setNote(t("editor.translatePartial", { model: vars.model, n: j.untranslated, sections: (j.untranslatedSections ?? []).join(", ") }));
    else setNote(t(local ? "editor.translatedLocal" : "editor.translated", vars));
  };

  /** On this PC. An installed Ollama that is not running is started by the desktop shell first. */
  const runLocal = async () => {
    let now = await check();
    if (now && !now.local.ok && now.local.reason === "ollama_down" && desktopBridge()?.localAi?.start) {
      setNote(t("editor.localStarting"));
      desktopBridge()?.localAi?.start?.();
      const until = Date.now() + START_WAIT_MS;
      while (alive.current && Date.now() < until && now && !now.local.ok && now.local.reason === "ollama_down") {
        await new Promise((r) => setTimeout(r, 2000));
        now = await check();
      }
      if (alive.current) setNote(t("editor.translating"));
    }
    if (now && !now.local.ok) {
      setStuck(now.local.reason);
      setNote(null);
      return;
    }
    const res = await fetch("/api/script/translate", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ text, to, provider: "local" }) });
    const j = (await res.json()) as Answer;
    if (j.unavailable) {
      setStuck(j.unavailable);
      setNote(j.unavailable === "ollama_down" || j.unavailable === "no_model" ? null : localUnavailableText(j.unavailable, t, j.error ?? ""));
      void check();
      return;
    }
    if (!res.ok || !j.text) throw new Error(j.error ?? `HTTP ${res.status}`);
    show(j, true);
  };

  /** In the cloud: named first, asked once, shown while it is sent. */
  const runCloud = async () => {
    const done = await pageOutbound().gated("script", (r) => r.script, async (consent, quiet) => {
      const res = await fetch("/api/script/translate", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders(), ...consent }, body: JSON.stringify({ text, to, provider: "cloud" }) });
      if (res.status === 403) quiet(); // refused here: nothing left this PC
      return { res, j: (await res.json()) as Answer };
    });
    if (!done.sent) {
      setNote(done.reason === "unknown" ? okt("noticeUnknown") : null);
      return;
    }
    const { res, j } = done.value;
    if (j.unavailable === "disabled") {
      setNote(t("editor.whereCloudOffline"));
      return;
    }
    if (!res.ok || !j.text) throw new Error(j.error ?? `HTTP ${res.status}`);
    show(j, false);
  };

  const translate = async (on: TranslateWhere = where) => {
    setBusy(true);
    setStuck(null);
    setNote(t("editor.translating"));
    try {
      await ensureEngineToken();
      await (on === "local" ? runLocal() : runCloud());
    } catch (err) {
      setNote(t("editor.translateFailed", { error: localizeFreeLlmError((err as Error).message, getLang()) }));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const hint = whereHint(where, state, who, t);
  const blocked = where === "local" && (stuck !== null || hint.blocked);
  // after a press that could not run locally, the reason is the one that press met
  const whereText = where === "local" && stuck && (stuck === "ollama_down" || stuck === "no_model") ? localUnavailableText(stuck, t) : hint.text;
  const cloudOff = Boolean(state?.offline);

  const row = (
    <>
      <span className="hint" style={{ marginLeft: "auto" }}>{t("editor.translateTo")}</span>
      <select className="btn" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} aria-label={t("editor.translateTo")} data-testid="translate-to">
        {LANGS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <select className="btn translate-where" value={where} onChange={(e) => choose(e.target.value === "cloud" ? "cloud" : "local")} disabled={busy} aria-label={t("editor.translateWhere")} data-testid="translate-where">
        <option value="local">{t("editor.whereLocal")}</option>
        <option value="cloud">{t("editor.whereCloud", { who })}</option>
      </select>
      <button className="btn" disabled={busy || !text.trim() || (where === "cloud" && cloudOff)} onClick={() => void translate()} data-testid="translate-go">
        {busy ? t("editor.translating") : t("editor.translate")}
      </button>
    </>
  );

  const below = (
    <>
      {!busy && (
        <div className="hint translate-where-hint" data-testid="translate-where-hint" data-where={where} data-blocked={blocked ? "1" : "0"}>
          {whereText}
        </div>
      )}
      {!busy && blocked && (
        <div className="controls translate-ways">
          <button
            className="btn"
            disabled={cloudOff || !text.trim()}
            title={cloudOff ? t("editor.whereCloudOffline") : t("editor.whereCloudHint", { who })}
            onClick={() => {
              // the user's own choice, remembered like the select; the notice names who gets the script
              choose("cloud");
              void translate("cloud");
            }}
            data-testid="translate-use-cloud"
          >
            {t("editor.useCloud")}
          </button>
          <a className="btn" href="/settings/local#setup" target="_blank" rel="noreferrer" data-testid="translate-open-local">
            {t("editor.openLocalModels")}
          </a>
        </div>
      )}
      {note && <div className="hint" role="status" data-testid="translate-note">{note}</div>}
    </>
  );

  return { row, below, busy };
}
