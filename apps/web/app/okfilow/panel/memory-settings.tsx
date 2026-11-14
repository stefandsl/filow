"use client";
// "Remember things about me" in the OK Filow settings (docs/okfilow/MEMORY.md): the switch (off by
// default), and the list of what is kept on this PC, each with when and from which question it was
// learned, Delete for one and Delete all. The rules about what may be kept live in the desktop app.
import { useCallback, useEffect, useState } from "react";
import type { Lang } from "@filow/core";
import type { OkFilowBridge, OkFilowStatus } from "@/lib/buddy/bridge";
import type { MemoryFact } from "@/lib/buddy/memory";
import type { OkfKey } from "@/lib/buddy/text";

type Props = {
  lang?: Lang;
  bridge: OkFilowBridge;
  status: OkFilowStatus;
  t: (k: OkfKey) => string;
  configure: (patch: Partial<OkFilowStatus>) => Promise<void>;
  /** The one question before everything is deleted (the browser's own dialog; a test passes its own). */
  confirmClear?: (question: string) => boolean;
  /** The list before the desktop app has answered (tests; the panel reads it from the bridge). */
  initial?: MemoryFact[] | null;
  /** Goes up when an answer may have taught something: the list is read again. */
  learned?: number;
};

/** "14 Nov 2026" in the interface language; the stored ISO time when it cannot be read. */
const when = (at: string, lang: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
};

/** Facts learned from the same question on the same day, in the order they were learned: one source line each. */
export function groupBySource(facts: MemoryFact[]): Array<{ key: string; question: string; at: string; facts: MemoryFact[] }> {
  const groups: Array<{ key: string; question: string; at: string; facts: MemoryFact[] }> = [];
  for (const f of facts) {
    const key = `${f.at.slice(0, 10)}\n${f.question}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.facts.push(f);
    else groups.push({ key, question: f.question, at: f.at, facts: [f] });
  }
  return groups;
}

export function MemorySettings({ bridge, status, t, configure, lang = "en", confirmClear = (q) => window.confirm(q), initial = null, learned = 0 }: Props) {
  const api = bridge.memory;
  const [facts, setFacts] = useState<MemoryFact[]>(initial ?? []);
  const [note, setNote] = useState("");
  const refresh = useCallback(() => { void api?.list().then(setFacts).catch(() => {}); }, [api]);
  // Read again after an answer that may have taught something, and whenever the panel comes back.
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh, status.memory, learned]);
  if (!api) return null;

  const remove = async (id: string) => {
    try { setFacts(await api.remove(id)); } catch { refresh(); }
  };
  const clear = async () => {
    if (!confirmClear(t("memoryDeleteAllConfirm"))) return;
    try {
      setFacts(await api.clear());
      setNote(t("memoryDeletedAll"));
    } catch { refresh(); }
  };

  return (
    <div className="okf-memory">
      <label className="okf-row">
        <span>{t("memoryOn")}</span>
        <input type="checkbox" data-testid="memory-on" checked={status.memory === true} onChange={(e) => { setNote(""); void configure({ memory: e.target.checked }); }} />
      </label>
      <p className="okf-hint">{t("memoryHint")}</p>
      {(status.memory === true || facts.length > 0) && (
        <section className="okf-memory-list" aria-label={t("memoryListTitle")}>
          <h3>{t("memoryListTitle")}</h3>
          {facts.length === 0 ? <p className="okf-hint" data-testid="memory-empty">{note || t("memoryEmpty")}</p> : (
            <>
              {groupBySource(facts).map((g) => {
                // One short line per question: when and from which question (the whole question in the tooltip).
                const from = t("memoryFrom").replace("{when}", when(g.at, lang)).replace("{question}", g.question);
                return (
                  <div key={g.key} className="okf-memory-group" data-testid="memory-group">
                    <p className="okf-memory-from" title={from}>{from}</p>
                    <ul>
                      {g.facts.map((f) => (
                        <li key={f.id} data-testid="memory-fact">
                          <span className="okf-memory-text">{f.text}</span>
                          <button type="button" className="okf-link" data-testid="memory-delete" aria-label={t("memoryDeleteLabel").replace("{fact}", f.text)} onClick={() => void remove(f.id)}>{t("memoryDelete")}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <button type="button" className="okf-link" data-testid="memory-clear" onClick={() => void clear()}>{t("memoryDeleteAll")}</button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
