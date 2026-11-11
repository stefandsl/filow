"use client";
// The online model of the whiteboard, chosen in the whiteboard itself and in Settings. Both read
// and write the same place, so a choice made in one shows in the other. Each model has its own
// maker, so each asks for its own yes the first time a question is about to be sent to it.
import { useEffect, useId, useState } from "react";
import { useLang } from "@filow/ui";
import { WHITEBOARD_MODELS, WHITEBOARD_MODEL_KEY, chosenWhiteboardModel, type WhiteboardModel } from "@/lib/whiteboard/models";
import { wbText, type WbKey } from "@/lib/whiteboard/text";

const LABEL: Record<WhiteboardModel, WbKey> = { "anthropic/claude-sonnet-5.5": "model_sonnet", "google/gemini-2.5-flash": "model_flash" };

/** The choice kept in this profile, and how to change it. */
export function useWhiteboardModel(): [WhiteboardModel, (next: WhiteboardModel) => void] {
  const [model, setModel] = useState<WhiteboardModel>(WHITEBOARD_MODELS[0]);
  useEffect(() => {
    setModel(chosenWhiteboardModel());
    // a change made in another window (Settings while the whiteboard is open) shows here too
    const onStorage = (ev: StorageEvent) => { if (ev.key === WHITEBOARD_MODEL_KEY) setModel(chosenWhiteboardModel()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const choose = (next: WhiteboardModel) => {
    setModel(next);
    try { localStorage.setItem(WHITEBOARD_MODEL_KEY, next); } catch { /* no storage: the choice lasts for this page */ }
  };
  return [model, choose];
}

export function ModelPicker({ value, onChange, className, note }: { value: WhiteboardModel; onChange: (next: WhiteboardModel) => void; className?: string; note?: boolean }) {
  const lang = useLang();
  const id = useId();
  return (
    <div className={className} data-whiteboard-model={value}>
      <label htmlFor={id}>{wbText(lang, "modelLabel")}</label>
      <select id={id} value={value} onChange={(ev) => onChange(ev.target.value as WhiteboardModel)}>
        {WHITEBOARD_MODELS.map((m) => <option key={m} value={m}>{wbText(lang, LABEL[m])}</option>)}
      </select>
      {note && <p className="hint">{wbText(lang, "modelNote")}</p>}
    </div>
  );
}

/** The same choice as a section of Settings. */
export function WhiteboardModelSetting() {
  const lang = useLang();
  const [model, choose] = useWhiteboardModel();
  return (
    <section className="strip" data-setting="whiteboard-model">
      <h2>{wbText(lang, "modelHeading")}</h2>
      <ModelPicker value={model} onChange={choose} note />
    </section>
  );
}