"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@filow/core";
import { Wordmark } from "@filow/ui";
import { useUiLang } from "@/components/LangSwitch";
import { desktopBridge } from "@/lib/sessionUrl";
import "./tour.css";

export default function Tour() {
  const [lang] = useUiLang();
  const tr = (key: Parameters<typeof t>[0]) => t(key, lang);
  const target = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState("");
  const [highlighted, setHighlighted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/");
  useEffect(() => {
    const url = new URL(location.href).searchParams.get("next");
    if (url === "/" || url?.startsWith("/settings/local?auto=")) setNext(url);
    const clear = () => { setHighlighted(false); void desktopBridge()?.tour?.mark(null).catch(() => {}); };
    window.addEventListener("resize", clear); window.addEventListener("blur", clear);
    window.addEventListener("scroll", clear, true);
    return () => { clear(); window.removeEventListener("resize", clear); window.removeEventListener("blur", clear); window.removeEventListener("scroll", clear, true); };
  }, []);
  async function highlight() {
    const tour = desktopBridge()?.tour;
    if (!tour || !target.current) { setMessage(tr("tour.desktopOnly")); return; }
    setBusy(true);
    try {
      const { x, y, width, height } = target.current.getBoundingClientRect();
      await tour.mark({ x: x - 8, y: y - 8, width: width + 16, height: height + 16 });
      setHighlighted(true); setMessage(tr("tour.marked"));
    } catch { setMessage(tr("tour.retry")); }
    finally { setBusy(false); }
  }
  async function ask() {
    setBusy(true);
    try {
      const ready = await desktopBridge()?.tour?.ask(tr("tour.question"));
      setMessage(tr(ready ? "tour.askStarted" : "tour.retry"));
    } catch { setMessage(tr("tour.retry")); }
    finally { setBusy(false); }
  }
  return <main className="tour-page">
    <header className="tour-header"><Wordmark height={30} /><Link className="btn" href="/account">{tr("account.title")}</Link></header>
    <div className="tour-layout">
      <section className="tour-copy">
        <p className="tour-eyebrow">{tr("tour.step")}</p>
        <h1>{tr("tour.title")}</h1>
        <p className="tour-lead">{tr("tour.intro")}</p>
        <ol className="tour-instructions"><li>{tr("tour.first")}</li><li>{tr("tour.second")}</li><li>{tr("tour.third")}</li></ol>
        <div className="tour-actions"><button className="btn primary" onClick={() => void highlight()} disabled={busy}>{tr("tour.highlight")}</button><button className="btn" onClick={() => void ask()} disabled={busy}>{tr("tour.ask")}</button></div>
        <p className="tour-status" role="status">{message || tr("tour.private")}</p>
        <Link className="tour-continue" href={next} onClick={() => { void desktopBridge()?.tour?.done().catch(() => {}); }}>{tr("tour.continue")} →</Link>
      </section>
      <section className="tour-preview" aria-label={tr("tour.practice")}>
        <div className="tour-preview-bar"><span className="tour-dot" /><span>{tr("tour.practice")}</span><span className="tour-local">{tr("tour.local")}</span></div>
        <div className="tour-paper"><p className="tour-paper-label">FILOW</p><h2>{tr("tour.sampleTitle")}</h2><p>{tr("tour.sampleText")}</p><div className="tour-lines"><i/><i/><i/></div><button ref={target} className="btn primary" onClick={() => setMessage(tr("tour.saved"))}>{tr("tour.target")}</button></div>
        <p className="tour-preview-note">{tr(highlighted ? "tour.marked" : "tour.guided")}</p>
      </section>
    </div>
    <footer className="tour-footer"><Link href="/settings/local">{tr("tour.setup")}</Link><span>{tr("tour.stop")}</span></footer>
  </main>;
}
