"use client";
// The controls every model row shares (Settings > local models, Dictation, the setup picker):
// "Stop" next to a download's percent, the "in use" badge next to "installed", and the list of the
// models the desktop app keeps in its own folder with a "Delete" for each.
import { useCallback, useEffect, useState } from "react";
import type { I18nKey } from "@filow/core";
import { useT } from "@filow/ui";
import { deleteQuestion, deviceUses, listedModels, sizeText, usesText, type DeviceModel, type DeviceModels, type ModelUseItem, type UseContext } from "@/lib/modelUse";

type ModelsBridge = {
  status(): Promise<DeviceModels>;
  cancel(id: string): Promise<{ ok: boolean; stopped: boolean }>;
  /** code "take": a take that is running listens with this model; nothing was deleted. */
  remove(id: string): Promise<{ ok: boolean; freedBytes?: number; error?: string; code?: string }>;
};
/** The desktop app's models bridge; null in the browser and in desktop builds before 0.9.35. */
export const modelsBridge = () => (globalThis as { filow?: { models?: ModelsBridge } }).filow?.models ?? null;

/**
 * "Stop" for a download in flight: a real button (keyboard, focus ring) with the model's name in its
 * accessible name, placed right after the percent so the pill does not move when it appears.
 */
export function StopButton({ name, onStop, hint, small }: { name: string; onStop: () => void; hint?: string; small?: boolean }) {
  const t = useT();
  return (
    <button type="button" className={`btn stop-download${small ? " small" : ""}`} data-testid="stop-download" aria-label={t("settings.stopLabel", { name })} title={hint ?? t("settings.stopHint")} onClick={onStop}>
      {t("settings.stop")}
    </button>
  );
}

/** "in use: dictation (Italiano)". Nothing when the model is installed only: the absence is the message. */
export function InUseChip({ uses }: { uses: ModelUseItem[] }) {
  const t = useT();
  if (uses.length === 0) return null;
  return (
    <span className="chip inuse" data-testid="in-use">
      {t("settings.inUse", { what: usesText(uses, t) })}
    </span>
  );
}

export type DeviceNotice = { kind: "freed" | "failed"; text: string } | null;

/** What the list says after a delete: the size freed, or why nothing was deleted, in the user's words. */
export function deleteNotice(name: string, r: { ok: boolean; freedBytes?: number; error?: string; code?: string }, t: ReturnType<typeof useT>): NonNullable<DeviceNotice> {
  if (r.ok) return { kind: "freed", text: t("settings.freed", { name, size: sizeText(r.freedBytes ?? 0, t) }) };
  if (r.code === "take") return { kind: "failed", text: t("settings.deleteDuringTake", { name }) };
  return { kind: "failed", text: t("settings.deleteFailed", { name, error: r.error ?? "" }) };
}

/** The rows, without the bridge: what the list shows for a given status (unit tested). */
export function DeviceModelRows({ data, ctx, busy, notice, onDelete }: { data: DeviceModels; ctx: UseContext; busy: string | null; notice: DeviceNotice; onDelete: (m: DeviceModel) => void }) {
  const t = useT();
  // A model is listed once it is on disk for good. While it downloads, its percent and Stop are where the
  // download was started: a row appearing here at that moment would push that button away from the pointer.
  const models = listedModels(data);
  return (
    <section className="strip device-models" data-testid="device-models">
      <div className="label">{t("settings.onThisPc")}</div>
      <div className="hint">{t("settings.onThisPcHint")}</div>
      {models.length === 0 && <div className="hint">{t("settings.onThisPcNone")}</div>}
      {models.map((m) => {
        const uses = deviceUses(m, ctx);
        return (
          <div key={m.id} className="model" data-model={m.id}>
            <div>
              <strong>{m.name}</strong> <span className="chip">{t(`modelKind.${m.kind}` as I18nKey)}</span>{" "}
              {m.installed ? <span className="chip live">{t("settings.installed")}</span> : <span className="chip">{t("settings.partial")}</span>} <InUseChip uses={m.installed ? uses : []} />
              <div className="hint memline">
                <span>{sizeText(m.bytes, t)}</span>
                {m.loaded && <span>{t("settings.loaded")}</span>}
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn danger" data-testid="delete-model" disabled={busy === m.id} aria-label={t("settings.deleteLabel", { name: m.name })} onClick={() => onDelete(m)}>
                {t("settings.delete")}
              </button>
            </div>
          </div>
        );
      })}
      {/* Always in the page, so a screen reader hears the result and the rows do not jump when it appears. */}
      <div className={`hint device-notice${notice?.kind === "failed" ? " failed" : ""}`} role="status" data-testid="device-notice">{notice?.text ?? ""}</div>
    </section>
  );
}

/**
 * The models in Filow's own folder (speech recognition, the natural voice, S1-mini, the punctuation
 * model): size, "installed", "in use" and for what, "loaded in memory", and Delete with one question
 * that names the model and its size. Shown in the desktop app only.
 */
export function DeviceModelList({ ctx, onChange, confirmDelete = (text) => window.confirm(text) }: { ctx: UseContext; onChange?: () => void; confirmDelete?: (text: string) => boolean }) {
  const t = useT();
  const [data, setData] = useState<DeviceModels | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<DeviceNotice>(null);
  const read = useCallback(() => {
    void modelsBridge()?.status().then(setData).catch(() => {});
  }, []);
  useEffect(() => {
    read();
    const timer = setInterval(read, 2000);
    // A window in the background has its timers slowed down: coming back to it shows the present at once.
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => { clearInterval(timer); window.removeEventListener("focus", read); document.removeEventListener("visibilitychange", read); };
  }, [read]);
  if (!modelsBridge() || !data) return null;

  const remove = async (m: DeviceModel) => {
    const question = deleteQuestion({ name: m.name, size: sizeText(m.bytes, t), uses: m.installed ? deviceUses(m, ctx) : [], effect: m.kind }, t);
    if (!confirmDelete(question)) return;
    setBusy(m.id);
    setNotice(null);
    try {
      const r = await modelsBridge()!.remove(m.id);
      setNotice(deleteNotice(m.name, r, t));
    } catch (err) {
      setNotice({ kind: "failed", text: t("settings.deleteFailed", { name: m.name, error: String((err as Error).message ?? err) }) });
    } finally {
      setBusy(null);
      read();
      onChange?.();
    }
  };
  return <DeviceModelRows data={data} ctx={ctx} busy={busy} notice={notice} onDelete={(m) => void remove(m)} />;
}
