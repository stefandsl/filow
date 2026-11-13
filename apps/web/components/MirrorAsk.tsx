"use client";
// "Ask OK Filow" on a paired phone (the mirror page): a typed question goes over the session the phone
// paired into, and OK Filow asks it on the computer (lib/buddy/phoneAsk.ts). The answer stays there.
import { useId, useState } from "react";
import { PHONE_QUESTION_MAX, type Command } from "@filow/core";
import { useT } from "@filow/ui";
import { phoneAskLine, phoneQuestion } from "@/lib/buddy/phoneAsk";

export function MirrorAsk({ send }: { send: (cmd: Command) => Promise<{ ok: boolean; error?: string }> }) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null);
  const question = phoneQuestion(text);
  return (
    <form className="strip mirror-ask" aria-labelledby={`${id}-label`} data-testid="mirror-ask"
      onSubmit={(e) => {
        e.preventDefault();
        if (!question || sending) return;
        setSending(true);
        void send({ type: "askOkFilow", text: question })
          .catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
          .then((r) => {
            const said = phoneAskLine(r);
            setLine({ ok: r.ok, text: t(said.key, said.error === undefined ? undefined : { error: said.error }) });
            if (r.ok) setText("");
            setSending(false);
          });
      }}>
      <label className="label" id={`${id}-label`} htmlFor={`${id}-q`}>{t("mirror.ask.label")}</label>
      <div className="mirror-ask-row">
        <input id={`${id}-q`} className="btn mirror-ask-input" type="text" enterKeyHint="send" autoComplete="off" maxLength={PHONE_QUESTION_MAX}
          value={text} onChange={(e) => setText(e.target.value)} placeholder={t("mirror.ask.placeholder")} aria-describedby={`${id}-where ${id}-line`} />
        <button className="btn primary" type="submit" disabled={!question || sending}>{sending ? t("mirror.ask.sending") : t("mirror.ask.send")}</button>
      </div>
      <p className={`mirror-ask-line ${line && !line.ok ? "err" : ""}`} id={`${id}-line`} role="status" aria-live="polite">{line?.text ?? ""}</p>
      <p className="hint" id={`${id}-where`}>{t("mirror.ask.where")}</p>
    </form>
  );
}
