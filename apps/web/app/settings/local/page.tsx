"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LANG_LABELS, LANGS, SCREEN_MODE_LABELS, type DecisionProviderId, type Lang, type ScreenMode } from "@intelliprompter/core";
import { preloadWhisper, selectedWhisperModel, setSelectedWhisperModel, whisperCached } from "@intelliprompter/stt";
import { LangProvider, useT } from "@intelliprompter/ui";
import { engineHeaders } from "@/components/useSession";
import { LangSwitch, useUiLang } from "@/components/LangSwitch";
import { getDecisionProvider, getScreenMode, setDecisionProvider, setScreenMode } from "@/lib/prefs";
import { screenBridge } from "@/lib/screen/watcher";

type Status = {
  pii: { mode: "off" | "on" | "strict"; serverUrl: string; serverReachable: boolean };
  ollama: { url: string; reachable: boolean; version: string | null; minimum: string; ok: boolean };
  machine: { ramGb: number; platform: string; arch: string };
  offline: boolean;
  defaultProvider: string;
  openrouterKey: boolean;
  cloudflareKey: boolean;
  recommendation: string | null;
  models: Array<{
    name: string; kind: string; runtime: "ollama" | "browser"; label: string; description: string; downloadGb: number; ramGb: number;
    status: "available" | "planned"; fit: "fits" | "tight" | "too big"; installed: boolean; ollamaOk: boolean;
  }>;
};

export default function LocalModelsPage() {
  const [lang, setLang] = useUiLang();
  return (
    <LangProvider lang={lang}>
      <SettingsInner lang={lang} onLang={setLang} />
    </LangProvider>
  );
}

function SettingsInner({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState<DecisionProviderId | "">("");
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [whisperModel, setWhisperModel] = useState("");
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [screenMode, setScreenModeState] = useState<ScreenMode>("balanced");
  const [hotkey, setHotkey] = useState<{ hotkey: string; enabled: boolean } | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState("");
  const [hotkeyMsg, setHotkeyMsg] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/local/status", { cache: "no-store" });
    const s = (await res.json()) as Status;
    setStatus(s);
    const c: Record<string, boolean> = {};
    for (const m of s.models) if (m.runtime === "browser") c[m.name] = await whisperCached(m.name);
    setCached(c);
  }, []);

  useEffect(() => {
    setProvider(getDecisionProvider() ?? "");
    setWhisperModel(selectedWhisperModel());
    setScreenModeState(getScreenMode());
    void screenBridge()
      ?.getSettings()
      .then((h) => {
        setHotkey(h);
        setHotkeyDraft(h.hotkey);
      });
    void refresh();
  }, [refresh]);

  const saveHotkey = async (next: { hotkey?: string; enabled?: boolean }) => {
    const bridge = screenBridge();
    if (!bridge) return;
    const r = await bridge.setSettings(next);
    setHotkey({ hotkey: r.hotkey, enabled: r.enabled });
    setHotkeyDraft(r.hotkey);
    setHotkeyMsg(r.ok ? t("settings.saved") : r.error ?? t("settings.hotkeyFailed"));
  };

  const download = async (name: string) => {
    setError(null);
    setProgress((p) => ({ ...p, [name]: t("settings.starting") }));
    try {
      const device = await preloadWhisper(name, (p) => {
        const pct = p.progress !== undefined ? ` ${Math.round(p.progress)}%` : "";
        setProgress((pr) => ({ ...pr, [name]: `${p.status}${p.file ? " " + p.file.split("/").pop() : ""}${pct}` }));
      });
      setTestResult((r) => ({ ...r, [name]: t("settings.readyOn", { device }) }));
      setCached((c) => ({ ...c, [name]: true }));
    } catch (err) {
      setError(`Whisper: ${(err as Error).message}`);
    } finally {
      setProgress((p) => ({ ...p, [name]: "" }));
    }
  };

  const pull = async (name: string) => {
    setError(null);
    setProgress((p) => ({ ...p, [name]: t("settings.starting") }));
    const res = await fetch("/api/local/pull", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ name }) });
    if (!res.ok || !res.body) {
      const { error } = (await res.json().catch(() => ({ error: `pull failed (${res.status})` }))) as { error?: string };
      setError(error ?? "pull failed");
      setProgress((p) => ({ ...p, [name]: "" }));
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
          if (j.error) setError(j.error);
          const pct = j.total && j.completed ? ` ${Math.round((j.completed / j.total) * 100)}%` : "";
          setProgress((p) => ({ ...p, [name]: `${j.status ?? ""}${pct}` }));
        } catch {
          /* partial line */
        }
      }
    }
    setProgress((p) => ({ ...p, [name]: "" }));
    void refresh();
  };

  const remove = async (name: string) => {
    if (!confirm(t("settings.deleteConfirm", { name }))) return;
    await fetch("/api/local/pull", { method: "DELETE", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ name }) });
    void refresh();
  };

  const test = async (name: string) => {
    setTestResult((r) => ({ ...r, [name]: t("settings.running") }));
    const res = await fetch("/api/local/test", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ model: name }) });
    const j = (await res.json()) as { ok: boolean; latencyMs?: number; error?: string; decisions?: Array<{ id: string; confidence: number }> };
    setTestResult((r) => ({
      ...r,
      [name]: j.ok
        ? `${j.latencyMs} ms · welcome ${Math.round((j.decisions?.[0]?.confidence ?? 0) * 100)}% · pricing ${Math.round((j.decisions?.[1]?.confidence ?? 0) * 100)}%`
        : t("settings.failed", { error: j.error ?? "" }),
    }));
  };

  const choose = (id: DecisionProviderId | "") => {
    setProvider(id);
    setDecisionProvider(id);
  };

  const providerLabel = (id: string) => (id === "openrouter" || id === "clef-local" || id === "clef-cloudflare" ? t(`provider.${id}`) : id);

  return (
    <div className="app settings">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> INTELLIPROMPTER
        </div>
        <span className="subtitle">{t("settings.subtitle")}</span>
        <span className="spacer" />
        {status?.offline && <span className="chip err">{t("app.offline")}</span>}
        <LangSwitch lang={lang} onChange={onLang} />
        <Link className="btn" href="/">
          {t("common.back")}
        </Link>
      </header>

      <section className="strip">
        <div className="label">{t("common.language")}</div>
        <div className="row">
          {LANGS.map((l) => (
            <label key={l} className={`btn choice ${lang === l ? "primary" : ""}`}>
              <input type="radio" name="lang" checked={lang === l} onChange={() => onLang(l)} /> {LANG_LABELS[l]}
            </label>
          ))}
        </div>
        <div className="hint">{t("settings.languageHint")}</div>
      </section>

      {!status ? (
        <div className="hint">{t("common.loading")}</div>
      ) : (
        <>
          <section className="strip">
            <div className="label">{t("settings.provider")}</div>
            <div className="hint">{t("settings.providerHint")}</div>
            <div className="row">
              {(["openrouter", "clef-local", "clef-cloudflare"] as DecisionProviderId[]).map((id) => {
                const disabled =
                  (id === "openrouter" && (!status.openrouterKey || status.offline)) ||
                  (id === "clef-cloudflare" && (!status.cloudflareKey || status.offline));
                return (
                  <label key={id} className={`btn choice ${provider === id ? "primary" : ""}`} title={disabled ? t("settings.notConfigured") : ""}>
                    <input type="radio" name="provider" checked={provider === id} disabled={disabled} onChange={() => choose(id)} /> {t(`provider.${id}`)}
                  </label>
                );
              })}
              <label className={`btn choice ${provider === "" ? "primary" : ""}`}>
                <input type="radio" name="provider" checked={provider === ""} onChange={() => choose("")} />{" "}
                {t("settings.serverDefault", { name: providerLabel(status.defaultProvider) })}
              </label>
            </div>
          </section>

          <section className="strip">
            <div className="label">Ollama</div>
            <div className="row">
              <span className={`chip ${status.ollama.ok ? "live" : "err"}`}>
                {status.ollama.reachable ? `● ${status.ollama.version}${status.ollama.ok ? "" : ` ${t("settings.ollamaNeed", { v: status.ollama.minimum })}`}` : t("settings.ollamaNotRunning")}
              </span>
              <span className="hint">{status.ollama.url}</span>
              <span className="hint">
                {t("settings.machine", { ram: status.machine.ramGb, platform: status.machine.platform, arch: status.machine.arch })}{" "}
                {status.recommendation ? t("settings.recommended", { name: status.recommendation }) : t("settings.tooLittleRam")}
              </span>
            </div>
            {!status.ollama.ok && (
              <div className="hint">
                {t("settings.installOllama", { v: status.ollama.minimum })}{" "}
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                  ollama.com/download
                </a>
              </div>
            )}
          </section>

          <section className="strip">
            <div className="label">{t("settings.models")}</div>
            {status.models.map((m) => (
              <div key={m.name} className="model">
                <div>
                  <strong>{m.label}</strong> <span className="chip">{m.kind}</span>{" "}
                  <span className={`chip ${m.fit === "fits" ? "live" : m.fit === "tight" ? "" : "err"}`}>{t(`fit.${m.fit}`)}</span>
                  {(m.installed || cached[m.name]) && <span className="chip live">{t("settings.installed")}</span>}
                  {m.runtime === "browser" && whisperModel === m.name && <span className="chip">{t("settings.selectedWhisper")}</span>}
                  {m.status === "planned" && <span className="chip">{t("settings.planned")}</span>}
                  <div className="hint">
                    {m.description} {t("settings.sizes", { dl: m.downloadGb, ram: m.ramGb })}
                  </div>
                </div>
                <div className="row">
                  {m.status === "available" && m.runtime === "browser" && (
                    <>
                      <button className="btn primary" disabled={Boolean(progress[m.name])} onClick={() => void download(m.name)}>
                        {progress[m.name] ? progress[m.name] : cached[m.name] ? t("settings.recheck") : t("settings.download")}
                      </button>
                      {whisperModel !== m.name && (
                        <button
                          className="btn"
                          onClick={() => {
                            setSelectedWhisperModel(m.name);
                            setWhisperModel(m.name);
                          }}
                        >
                          {t("settings.useWhisper")}
                        </button>
                      )}
                    </>
                  )}
                  {m.status === "available" && m.runtime === "ollama" && !m.installed && (
                    <button className="btn primary" disabled={!m.ollamaOk || Boolean(progress[m.name])} onClick={() => void pull(m.name)}>
                      {progress[m.name] ? progress[m.name] : t("settings.pull")}
                    </button>
                  )}
                  {m.installed && m.kind === "decision" && (
                    <button className="btn" onClick={() => void test(m.name)}>
                      {t("settings.test")}
                    </button>
                  )}
                  {m.installed && m.runtime === "ollama" && (
                    <button className="btn danger" onClick={() => void remove(m.name)}>
                      {t("settings.delete")}
                    </button>
                  )}
                  {testResult[m.name] && <span className="hint">{testResult[m.name]}</span>}
                </div>
              </div>
            ))}
          </section>

          <section className="strip">
            <div className="label">Screen Sense</div>
            <div className="hint">{t("settings.screenHint")}</div>
            <div className="row">
              {(Object.keys(SCREEN_MODE_LABELS) as ScreenMode[]).map((m) => (
                <label key={m} className={`btn choice ${screenMode === m ? "primary" : ""}`}>
                  <input
                    type="radio"
                    name="screenMode"
                    checked={screenMode === m}
                    onChange={() => {
                      setScreenModeState(m);
                      setScreenMode(m);
                    }}
                  />{" "}
                  {t(`mode.${m}`)}
                </label>
              ))}
            </div>
            <div className="hint">{t("settings.screenModes")}</div>
            {hotkey ? (
              <div className="row">
                <label className={`btn choice ${hotkey.enabled ? "primary" : ""}`}>
                  <input type="checkbox" checked={hotkey.enabled} onChange={(e) => void saveHotkey({ enabled: e.target.checked })} /> {t("settings.hotkeyEnabled")}
                </label>
                <input className="btn" value={hotkeyDraft} onChange={(e) => setHotkeyDraft(e.target.value)} placeholder="CommandOrControl+Shift+Space" title={t("settings.hotkeyTitle")} />
                <button className="btn" onClick={() => void saveHotkey({ hotkey: hotkeyDraft })}>
                  {t("settings.saveHotkey")}
                </button>
                {hotkeyMsg && <span className="hint">{hotkeyMsg}</span>}
                <span className="hint">{t("settings.hotkeyHint")}</span>
              </div>
            ) : (
              <div className="hint">{t("settings.browserScreen")}</div>
            )}
          </section>

          <section className="strip">
            <div className="label">{t("settings.privacy")}</div>
            <div className="row">
              <span className={`chip ${status.pii.mode === "off" ? "err" : "live"}`}>{t("settings.piiGuard", { mode: status.pii.mode })}</span>
              <span className={`chip ${status.pii.serverReachable ? "live" : ""}`}>{status.pii.serverReachable ? t("settings.rizzoRunning") : t("settings.rizzoNotRunning")}</span>
              <span className="hint">{status.pii.serverUrl}</span>
            </div>
            <div className="hint">{t("settings.piiHint")}</div>
            {!status.pii.serverReachable && (
              <div className="hint">
                {t("settings.rizzoStart")} <code>git clone https://github.com/Rizzo-AI-Academy/rizzo-pii && cd rizzo-pii && docker build -t rizzo-pii . && docker run -p 127.0.0.1:5005:5005 rizzo-pii</code>
              </div>
            )}
            <div className="hint">{t("settings.offlineHint")}</div>
          </section>
          {error && <span className="chip err">{error}</span>}
        </>
      )}
    </div>
  );
}
