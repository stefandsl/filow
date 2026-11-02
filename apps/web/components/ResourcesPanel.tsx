"use client";

import { useEffect, useState } from "react";
import { useT } from "@filow/ui";
import { engineHeaders, ensureEngineToken } from "@/components/useSession";

/** Shape of /api/local/resources. */
export type Resources = {
  cpu: { pct: number; cores: number; model: string };
  ram: { usedGb: number; totalGb: number };
  gpu: { name: string; kind: "discrete" | "integrated" | "unified" | "none"; vramTotalGb: number | null; vramUsedGb: number | null; sharedUsedGb: number | null; utilPct: number | null };
  loaded: Array<{ name: string; sizeGb: number; vramGb: number; gpuPct: number; where: "gpu" | "cpu" | "mixed" }>;
  advice: { local: boolean; reason: "gpu" | "ram" | "none" };
};

/** Polls the resources endpoint every `everyMs` while mounted. */
export function useResources(everyMs = 3000): Resources | null {
  const [res, setRes] = useState<Resources | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = (await fetch("/api/local/resources", { cache: "no-store" }).then((x) => x.json())) as Resources;
        if (!stop) setRes(r);
      } catch {
        /* keep the last reading */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), everyMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [everyMs]);
  return res;
}

export function Meter({ name, pct, text }: { name: string; pct: number; text: string }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{name}</span>
        <span className="hint">{text}</span>
      </div>
      <div className="meter-bar">
        <i style={{ width: `${p}%` }} className={p > 90 ? "hot" : p > 70 ? "warm" : ""} />
      </div>
    </div>
  );
}

export function placementText(t: ReturnType<typeof useT>, m: Resources["loaded"][number]): string {
  return m.where === "gpu" ? t("res.onGpu") : m.where === "cpu" ? t("res.onCpu") : t("res.mixed", { pct: m.gpuPct });
}

/**
 * Live machine dashboard: CPU, RAM, GPU memory and load, where each loaded model runs, best option.
 * `compact` is the one-row version for the prompter page; it can be collapsed to a single line.
 */
export function ResourcesPanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const res = useResources(compact ? 4000 : 3000);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("prefs:resourcesCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("prefs:resourcesCollapsed", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  if (!res) {
    return compact ? null : (
      <section className="strip resources">
        <div className="label">{t("res.label")}</div>
        <div className="hint">{t("common.loading")}</div>
      </section>
    );
  }
  const gpuPct = res.gpu.vramTotalGb && res.gpu.vramUsedGb !== null ? Math.round((res.gpu.vramUsedGb / res.gpu.vramTotalGb) * 100) : (res.gpu.utilPct ?? 0);
  const gpuText =
    res.gpu.vramTotalGb && res.gpu.vramUsedGb !== null
      ? `${res.gpu.vramUsedGb} / ${res.gpu.vramTotalGb} GB${res.gpu.sharedUsedGb ? ` · +${res.gpu.sharedUsedGb} GB ${t("res.sharedRam")}` : ""}`
      : res.gpu.sharedUsedGb !== null
        ? `${res.gpu.sharedUsedGb} GB ${t("res.sharedRam")}`
        : "—";
  const advice = res.advice.local ? t(res.advice.reason === "gpu" ? "res.adviceGpu" : "res.adviceRam") : t("res.adviceCloud");
  const unload = async (name: string) => {
    await ensureEngineToken();
    await fetch("/api/local/unload", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ name }) });
  };
  const loaded = res.loaded.map((m) => (
    <span key={m.name} className={`chip ${m.where === "gpu" ? "live" : m.where === "cpu" ? "err" : ""}`} style={{ marginRight: 6 }}>
      {m.name} · {placementText(t, m)} · {m.sizeGb} GB{" "}
      <button type="button" className="linkbtn" title={t("settings.unload")} aria-label={t("settings.unload")} onClick={() => void unload(m.name)}>
        ✕
      </button>
    </span>
  ));

  if (compact && collapsed) {
    return (
      <section className="strip resources compact">
        <button className="label linkish" onClick={toggle} title={t("res.expand")}>
          ▸ {t("res.label")} · CPU {res.cpu.pct}% · RAM {res.ram.usedGb}/{res.ram.totalGb} GB
          {res.gpu.kind !== "none" ? ` · GPU ${gpuPct}%` : ""}
          {res.loaded.length ? ` · ${res.loaded.map((m) => `${m.name} ${placementText(t, m)}`).join(", ")}` : ""}
        </button>
      </section>
    );
  }
  return (
    <section className={`strip resources ${compact ? "compact" : ""}`}>
      {compact ? (
        <button className="label linkish" onClick={toggle} title={t("res.collapse")}>
          ▾ {t("res.label")}
        </button>
      ) : (
        <div className="label">{t("res.label")}</div>
      )}
      <div className="meters">
        <Meter name={t("res.cpu")} pct={res.cpu.pct} text={`${res.cpu.pct}% · ${res.cpu.cores} ${t("res.cores")}`} />
        <Meter name={t("res.ram")} pct={Math.round((res.ram.usedGb / res.ram.totalGb) * 100)} text={`${res.ram.usedGb} / ${res.ram.totalGb} GB`} />
        {res.gpu.kind !== "none" && <Meter name={res.gpu.kind === "discrete" ? t("res.vram") : t("res.gpuShared")} pct={gpuPct} text={gpuText} />}
        {res.gpu.utilPct !== null && <Meter name={t("res.gpuLoad")} pct={res.gpu.utilPct} text={`${res.gpu.utilPct}%`} />}
      </div>
      <div className="hint">
        {res.gpu.kind === "none" ? t("res.noGpu") : `${res.gpu.name} · ${t(`res.kind.${res.gpu.kind}`)}`}
        {" · "}
        {advice}
      </div>
      <div className="hint">{res.loaded.length === 0 ? t("res.nothingLoaded") : loaded}</div>
    </section>
  );
}
