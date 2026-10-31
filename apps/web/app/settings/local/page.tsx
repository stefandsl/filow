"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DecisionProviderId } from "@intelliprompter/core";
import { preloadWhisper, selectedWhisperModel, setSelectedWhisperModel, whisperCached } from "@intelliprompter/stt";
import { engineHeaders } from "@/components/useSession";
import { getDecisionProvider, getScreenMode, PROVIDER_LABELS, setDecisionProvider, setScreenMode } from "@/lib/prefs";
import { SCREEN_MODE_LABELS, type ScreenMode } from "@intelliprompter/core";
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
    setHotkeyMsg(r.ok ? "saved" : r.error ?? "could not register");
  };

  const download = async (name: string) => {
    setError(null);
    setProgress((p) => ({ ...p, [name]: "starting…" }));
    try {
      const device = await preloadWhisper(name, (p) => {
        const pct = p.progress !== undefined ? ` ${Math.round(p.progress)}%` : "";
        setProgress((pr) => ({ ...pr, [name]: `${p.status}${p.file ? " " + p.file.split("/").pop() : ""}${pct}` }));
      });
      setTestResult((t) => ({ ...t, [name]: `ready on ${device}` }));
      setCached((c) => ({ ...c, [name]: true }));
    } catch (err) {
      setError(`Whisper: ${(err as Error).message}`);
    } finally {
      setProgress((p) => ({ ...p, [name]: "" }));
    }
  };

  const pull = async (name: string) => {
    setError(null);
    setProgress((p) => ({ ...p, [name]: "starting…" }));
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
    if (!confirm(`Delete ${name} from Ollama?`)) return;
    await fetch("/api/local/pull", { method: "DELETE", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ name }) });
    void refresh();
  };

  const test = async (name: string) => {
    setTestResult((t) => ({ ...t, [name]: "running…" }));
    const res = await fetch("/api/local/test", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ model: name }) });
    const j = (await res.json()) as { ok: boolean; latencyMs?: number; error?: string; decisions?: Array<{ id: string; confidence: number }> };
    setTestResult((t) => ({
      ...t,
      [name]: j.ok
        ? `${j.latencyMs} ms · welcome ${Math.round((j.decisions?.[0]?.confidence ?? 0) * 100)}% · pricing ${Math.round((j.decisions?.[1]?.confidence ?? 0) * 100)}%`
        : `failed: ${j.error}`,
    }));
  };

  const choose = (id: DecisionProviderId | "") => {
    setProvider(id);
    setDecisionProvider(id);
  };

  return (
    <div className="app settings">
      <header className="topbar">
        <div className="logo">
          <span className="dot" /> INTELLIPROMPTER
        </div>
        <span className="subtitle">/ settings / local models</span>
        <span className="spacer" />
        {status?.offline && <span className="chip err">OFFLINE</span>}
        <Link className="btn" href="/">
          ← Back
        </Link>
      </header>

      {!status ? (
        <div className="hint">Loading…</div>
      ) : (
        <>
          <section className="strip">
            <div className="label">Decision provider</div>
            <div className="hint">Who answers “has the speaker started this point?” twice a second. Local keeps everything on this machine.</div>
            <div className="row">
              {(["openrouter", "clef-local", "clef-cloudflare"] as DecisionProviderId[]).map((id) => {
                const disabled =
                  (id === "openrouter" && (!status.openrouterKey || status.offline)) ||
                  (id === "clef-cloudflare" && (!status.cloudflareKey || status.offline));
                return (
                  <label key={id} className={`btn choice ${provider === id ? "primary" : ""}`} title={disabled ? "not configured on the server, or offline mode" : ""}>
                    <input type="radio" name="provider" checked={provider === id} disabled={disabled} onChange={() => choose(id)} /> {PROVIDER_LABELS[id]}
                  </label>
                );
              })}
              <label className={`btn choice ${provider === "" ? "primary" : ""}`}>
                <input type="radio" name="provider" checked={provider === ""} onChange={() => choose("")} /> Server default ({PROVIDER_LABELS[status.defaultProvider as DecisionProviderId] ?? status.defaultProvider})
              </label>
            </div>
          </section>

          <section className="strip">
            <div className="label">Ollama</div>
            <div className="row">
              <span className={`chip ${status.ollama.ok ? "live" : "err"}`}>
                {status.ollama.reachable ? `● ${status.ollama.version}${status.ollama.ok ? "" : ` (need ${status.ollama.minimum}+)`}` : "○ not running"}
              </span>
              <span className="hint">{status.ollama.url}</span>
              <span className="hint">
                This machine: {status.machine.ramGb} GB RAM · {status.machine.platform}/{status.machine.arch}
                {status.recommendation ? ` · recommended: ${status.recommendation}` : " · too little RAM for Clef; use a cloud provider"}
              </span>
            </div>
            {!status.ollama.ok && (
              <div className="hint">
                Install or update Ollama from <a href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com/download</a> (version {status.ollama.minimum} or newer), start it, then reload this page.
                On a Debian server, point <code>OLLAMA_URL</code> at it.
              </div>
            )}
          </section>

          <section className="strip">
            <div className="label">Models</div>
            {status.models.map((m) => (
              <div key={m.name} className="model">
                <div>
                  <strong>{m.label}</strong> <span className="chip">{m.kind}</span>{" "}
                  <span className={`chip ${m.fit === "fits" ? "live" : m.fit === "tight" ? "" : "err"}`}>{m.fit}</span>
                  {(m.installed || cached[m.name]) && <span className="chip live">installed</span>}
                  {m.runtime === "browser" && whisperModel === m.name && <span className="chip">selected for Whisper</span>}
                  {m.status === "planned" && <span className="chip">planned</span>}
                  <div className="hint">
                    {m.description} Download ≈ {m.downloadGb} GB, needs ≈ {m.ramGb} GB RAM.
                  </div>
                </div>
                <div className="row">
                  {m.status === "available" && m.runtime === "browser" && (
                    <>
                      <button className="btn primary" disabled={Boolean(progress[m.name])} onClick={() => void download(m.name)}>
                        {progress[m.name] ? progress[m.name] : cached[m.name] ? "Re-check" : "Download"}
                      </button>
                      {whisperModel !== m.name && (
                        <button
                          className="btn"
                          onClick={() => {
                            setSelectedWhisperModel(m.name);
                            setWhisperModel(m.name);
                          }}
                        >
                          Use for Whisper
                        </button>
                      )}
                    </>
                  )}
                  {m.status === "available" && m.runtime === "ollama" && !m.installed && (
                    <button className="btn primary" disabled={!m.ollamaOk || Boolean(progress[m.name])} onClick={() => void pull(m.name)}>
                      {progress[m.name] ? progress[m.name] : "Pull"}
                    </button>
                  )}
                  {m.installed && m.kind === "decision" && (
                    <button className="btn" onClick={() => void test(m.name)}>
                      Test
                    </button>
                  )}
                  {m.installed && m.runtime === "ollama" && (
                    <button className="btn danger" onClick={() => void remove(m.name)}>
                      Delete
                    </button>
                  )}
                  {testResult[m.name] && <span className="hint">{testResult[m.name]}</span>}
                </div>
              </div>
            ))}
          </section>

          <section className="strip">
            <div className="label">Screen Sense</div>
            <div className="hint">
              Watches the screen, window or region you pick and turns each new slide into cues, facts and a gap check. Frames stay in memory, go once to the
              vision model on OpenRouter (<code>OPENROUTER_VISION_MODEL</code>, default google/gemini-2.5-flash) and are dropped; only the returned text is kept
              for the session. Views and phones only ever receive that text. Off in offline mode.
            </div>
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
                  {SCREEN_MODE_LABELS[m]}
                </label>
              ))}
            </div>
            <div className="hint">On slide change = one call per changed frame (16×16 mean difference, max 20 frames a minute). Balanced adds presenter cues (“as you can see”, “in questa slide”…). Real-time keeps calling every few seconds while the content keeps changing, for demos.</div>
            {hotkey ? (
              <div className="row">
                <label className={`btn choice ${hotkey.enabled ? "primary" : ""}`}>
                  <input type="checkbox" checked={hotkey.enabled} onChange={(e) => void saveHotkey({ enabled: e.target.checked })} /> Enabled (global hotkey registered)
                </label>
                <input className="btn" value={hotkeyDraft} onChange={(e) => setHotkeyDraft(e.target.value)} placeholder="CommandOrControl+Shift+Space" title="Electron accelerator, e.g. CommandOrControl+Shift+Space or Alt+PrintScreen" />
                <button className="btn" onClick={() => void saveHotkey({ hotkey: hotkeyDraft })}>
                  Save hotkey
                </button>
                {hotkeyMsg && <span className="hint">{hotkeyMsg}</span>}
                <span className="hint">The hotkey dims the screen; drag a rectangle and only that region is sent. Works outside a take too.</span>
              </div>
            ) : (
              <div className="hint">In the browser, Screen Sense shares a screen or window through the browser’s own picker. The region hotkey needs the desktop app.</div>
            )}
          </section>

          <section className="strip">
            <div className="label">Privacy</div>
            <div className="row">
              <span className={`chip ${status.pii.mode === "off" ? "err" : "live"}`}>PII guard: {status.pii.mode}</span>
              <span className={`chip ${status.pii.serverReachable ? "live" : ""}`}>
                Rizzo-PII server {status.pii.serverReachable ? "● running" : "○ not running (regex layer only)"}
              </span>
              <span className="hint">{status.pii.serverUrl}</span>
            </div>
            <div className="hint">
              Before any cloud call, personal data in the transcript, the points and the screen facts is replaced by placeholders
              (emails, phones, IBANs, card numbers, codice fiscale always; names, addresses and 22 Italian categories when the
              Rizzo-PII server runs). The map stays in memory and is dropped after the call. Local providers never need it.
              Set <code>PII_GUARD=strict</code> to refuse cloud calls without the server, <code>off</code> to disable.
            </div>
            {!status.pii.serverReachable && (
              <div className="hint">
                Start Rizzo-PII locally (Docker): <code>git clone https://github.com/Rizzo-AI-Academy/rizzo-pii && cd rizzo-pii && docker build -t rizzo-pii . && docker run -p 127.0.0.1:5005:5005 rizzo-pii</code>
              </div>
            )}
            <div className="hint">
              Offline mode (desktop app menu → Offline) forces local providers, on-device Whisper, and blocks every request that is not to this machine.
            </div>
          </section>
          {error && <span className="chip err">{error}</span>}
        </>
      )}
    </div>
  );
}
