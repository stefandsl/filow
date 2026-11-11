"use client";

// Settings > FreeLLMAPI: the address of the user's own router, its unified key, the model or
// routing strategy, a connection check, and the two switches that send takes and scripts through
// it. FreeLLMAPI is a separate app the user installs and runs; Filow only talks to it
// (lib/freellm.ts). The key goes to the desktop app's encrypted store; this page only ever learns
// whether one is saved and its last four characters.

import { useEffect, useId, useState } from "react";
import { useLang, useT } from "@filow/ui";
import type { I18nKey } from "@filow/core";
import { engineHeaders, ensureEngineToken } from "@/components/useSession";
import { FREELLM_DOWNLOAD_URL, normalizeBaseUrl, normalizeModel, type FreeLlmCheck } from "@/lib/freellm";
import { getCloudDecision, setCloudDecision } from "@/lib/prefs";

type FreeLlmStatus = { baseUrl: string; model: string; scripts: boolean; hasKey: boolean; keyHint?: string; offline: boolean };
type FreeLlmPatch = { baseUrl?: string; model?: string; scripts?: boolean; key?: string };
type FreeLlmBridge = {
  status(): Promise<FreeLlmStatus>;
  configure(patch: FreeLlmPatch): Promise<{ ok: boolean; error?: string; status: FreeLlmStatus }>;
};
const bridge = () => (globalThis as { filow?: { freeLlm?: FreeLlmBridge } }).filow?.freeLlm ?? null;

const STRATEGIES = ["auto", "auto:fast", "auto:smart", "auto:reliable", "auto:balanced"];
const ERRORS: Record<string, I18nKey> = { badUrl: "freellm.badUrl", badModel: "freellm.badModel", badKey: "freellm.keyBad", noKeyStore: "freellm.noKeyStore" };

export function FreeLlmSettings({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const lang = useLang();
  const id = useId();
  const [s, setS] = useState<FreeLlmStatus | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("auto");
  const [key, setKey] = useState("");
  const [takes, setTakes] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const take = (st: FreeLlmStatus | null) => {
      if (!live || !st) return;
      setS(st);
      setUrl(st.baseUrl ?? "");
      setModel(st.model || "auto");
    };
    const b = bridge();
    setDesktop(Boolean(b));
    setTakes(getCloudDecision() === "freellm");
    if (b) void b.status().then(take).catch(() => {});
    else {
      void ensureEngineToken()
        .then(() => fetch("/api/freellm/check", { headers: engineHeaders(), cache: "no-store" }))
        .then((r) => (r.ok ? (r.json() as Promise<FreeLlmStatus>) : null))
        .then(take)
        .catch(() => {});
    }
    return () => { live = false; };
  }, []);

  // A link to /settings/local#freellm (OK Filow panel, the Lite setup card): the section renders after its status loads.
  const loaded = s !== null;
  useEffect(() => {
    if (loaded && window.location.hash === "#freellm") document.getElementById("freellm")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (!s) return null;
  const urlOk = normalizeBaseUrl(url) !== null;
  const modelOk = normalizeModel(model) !== null;
  const dirty = url !== s.baseUrl || model !== s.model || key !== "";

  /** Sends one change to the desktop app; false when it refused it (the note says why). */
  const send = async (patch: FreeLlmPatch): Promise<boolean> => {
    const b = bridge();
    if (!b) return true;
    const r = await b.configure(patch);
    setS(r.status);
    if (!r.ok) {
      setNote({ ok: false, text: t(ERRORS[r.error ?? ""] ?? "freellm.badUrl") });
      return false;
    }
    onChange?.();
    return true;
  };
  /** Saves the address, the model and a newly typed key. */
  const saveFields = async (): Promise<boolean> => {
    const ok = await send({ baseUrl: url, model, ...(key ? { key } : {}) });
    if (ok) {
      // the desktop app tidies the address ("/v1" added): show what it saved
      const st = await bridge()?.status().catch(() => null);
      if (st) { setUrl(st.baseUrl); setModel(st.model); }
      setKey("");
    }
    return ok;
  };
  const withBusy = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const check = () => withBusy(async () => {
    setNote({ ok: true, text: t("freellm.checking") });
    // What is typed is saved first, so the check asks the router the user sees here.
    if (dirty && !(await saveFields())) return;
    await ensureEngineToken();
    const res = await fetch("/api/freellm/check", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ lang }) });
    const r = (await res.json()) as FreeLlmCheck;
    if (r.ok) {
      setModels(r.models);
      setNote({ ok: true, text: t(r.ready === 1 ? "freellm.okOne" : "freellm.ok", { n: r.ready }) });
    } else setNote({ ok: false, text: r.error });
  });

  const options = [...new Set([...STRATEGIES, ...models, model])].filter(Boolean);
  return (
    <section className="strip freellm" id="freellm" aria-labelledby={`${id}-title`}>
      <div className="label" id={`${id}-title`}>{t("freellm.title")}</div>
      <div className="hint">{t("freellm.intro")}</div>
      <div className="hint freellm-privacy">{t("freellm.privacy")}</div>
      <div className="hint">{t("freellm.personal")}</div>
      {s.offline && <div className="row"><span className="chip err">{t("freellm.offline")}</span></div>}

      <div className="freellm-fields">
        <label htmlFor={`${id}-url`}>{t("freellm.url")}</label>
        <div>
          <input id={`${id}-url`} className="btn freellm-input" type="url" inputMode="url" spellCheck={false} autoComplete="off" value={url} readOnly={!desktop}
            placeholder="http://localhost:3001/v1" aria-invalid={!urlOk} aria-describedby={`${id}-url-hint`} onChange={(e) => { setUrl(e.target.value); setNote(null); }} />
          <div className="hint" id={`${id}-url-hint`}>{urlOk ? t("freellm.urlHint") : t("freellm.badUrl")}</div>
        </div>

        {desktop ? <label htmlFor={`${id}-key`}>{t("freellm.key")}</label> : <span className="freellm-term">{t("freellm.key")}</span>}
        <div>
          {desktop && (
            <div className="row">
              <input id={`${id}-key`} className="btn freellm-input" type="password" spellCheck={false} autoComplete="off" value={key}
                aria-describedby={`${id}-key-hint`} onChange={(e) => { setKey(e.target.value); setNote(null); }} />
              {s.hasKey && <button type="button" className="btn" disabled={busy} onClick={() => void withBusy(async () => { if (await send({ key: "" })) setNote(null); })}>{t("freellm.keyRemove")}</button>}
            </div>
          )}
          <div className="hint" id={`${id}-key-hint`}>
            {s.hasKey ? t(s.keyHint ? "freellm.keySaved" : "freellm.keySavedPlain", { hint: s.keyHint ?? "" }) : t("freellm.keyNone")} {desktop ? t("freellm.keyHint") : ""}
          </div>
        </div>

        <label htmlFor={`${id}-model`}>{t("freellm.model")}</label>
        <div>
          <select id={`${id}-model`} className="btn freellm-input" value={model} disabled={!desktop} aria-describedby={`${id}-model-hint`} onChange={(e) => { setModel(e.target.value); setNote(null); }}>
            {options.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="hint" id={`${id}-model-hint`}>{t("freellm.modelHint")}</div>
        </div>
      </div>

      <label className="row freellm-check">
        <input type="checkbox" checked={takes} disabled={s.offline} onChange={(e) => { setCloudDecision(e.target.checked ? "freellm" : "openrouter"); setTakes(e.target.checked); }} />
        <span>{t("freellm.takes")}</span>
      </label>
      {desktop ? (
        <label className="row freellm-check">
          <input type="checkbox" checked={s.scripts} disabled={s.offline || busy} onChange={(e) => void withBusy(async () => { await send({ scripts: e.target.checked }); })} />
          <span>{t("freellm.scripts")}</span>
        </label>
      ) : (
        <div className="hint">{t("freellm.envOnly")}</div>
      )}

      <div className="row">
        {desktop && <button type="button" className="btn" data-act="save" disabled={busy || !dirty || !urlOk || !modelOk} onClick={() => void withBusy(async () => { if (await saveFields()) setNote({ ok: true, text: t("freellm.saved") }); })}>{t("freellm.save")}</button>}
        <button type="button" className="btn primary" data-act="check" disabled={busy || s.offline || !urlOk || !modelOk || (!s.hasKey && !key)} onClick={() => void check()}>{t("freellm.check")}</button>
        <a className="btn" href={FREELLM_DOWNLOAD_URL} target="_blank" rel="noreferrer">{t("freellm.get")}</a>
      </div>
      <div className="hint" role="status" aria-live="polite">
        {note && <span className={`chip ${note.ok ? "live" : "err"} freellm-note`}>{note.text}</span>}
      </div>
      <div className="hint">{t("freellm.use")}</div>
    </section>
  );
}
