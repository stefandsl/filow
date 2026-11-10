"use client";
import { sherpaNotes, type SherpaStatus } from "@filow/stt";
import { useT } from "@filow/ui";

/** Under the on-device speech model: which model the spoken language needs and, in plain words, what it gives up. */
export function SherpaLanguageNote({ s }: { s: SherpaStatus | null }) {
  const t = useT();
  const notes = sherpaNotes(s);
  if (notes.length === 0) return null;
  return (
    <div className="hint" data-testid="sherpa-language-note">
      {notes.map((n) => (
        <p key={n.key}>{t(n.key, n.vars)}</p>
      ))}
    </div>
  );
}
