"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DecisionProviderId } from "@intelliprompter/core";
import { engineHeaders } from "@/components/useSession";
import { getDecisionProvider, PROVIDER_LABELS, setDecisionProvider } from "@/lib/prefs";

type Status = {
  ollama: { url: string; reachable: boolean; version: string | null; minimum: string; ok: boolean };
  machine: { ramGb: number; platform: string; arch: string };
  offline: boolean;
  defaultProvider: string;
  openrouterKey: boolean;
  cloudflareKey: boolean;
  recommendation: string | null;
  models: Array<{
    name: string; kind: string; label: string; description: string; downloadGb: number; ramGb: number;
    status: "available" | "planned"; fit: "fits" | "tight" | "too big"; installed: boolean; ollamaOk: boolean;
  }>;
};

export default function LocalModelsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState<DecisionProviderId | "">("");
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/local/status", { cache: "no-store" });
    setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    setProvider(getDecisionProvider() ?? "");
    void refresh();
  }, [refresh]);

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
                  {m.installed && <span className="chip live">installed</span>}
                  {m.status === "planned" && <span className="chip">planned</span>}
                  <div className="hint">
                    {m.description} Download ≈ {m.downloadGb} GB, needs ≈ {m.ramGb} GB RAM.
                  </div>
                </div>
                <div className="row">
                  {m.status === "available" && !m.installed && (
                    <button className="btn primary" disabled={!m.ollamaOk || Boolean(progress[m.name])} onClick={() => void pull(m.name)}>
                      {progress[m.name] ? progress[m.name] : "Pull"}
                    </button>
                  )}
                  {m.installed && m.kind === "decision" && (
                    <button className="btn" onClick={() => void test(m.name)}>
                      Test
                    </button>
                  )}
                  {m.installed && (
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
            <div className="label">Privacy</div>
            <div className="hint">
              Offline mode (desktop app menu → Offline) forces local providers and blocks every request that is not to this machine.
              The PII guard (Rizzo-PII anonymisation before cloud calls) is specified in ARCHITECTURE.md §6.10 and lands in the next pass.
            </div>
          </section>
          {error && <span className="chip err">{error}</span>}
        </>
      )}
    </div>
  );
}
