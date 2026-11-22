"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { floatMicNode, openSelectedMic } from "@filow/stt";
import { t, type I18nKey } from "../../../../packages/core/src/i18n";
import { useUiLang, useUiTheme, ThemeSwitch } from "@/components/LangSwitch";
import { desktopBridge, type DailyTask, type DailyView } from "@/lib/sessionUrl";
import "./day-by-day.css";

export default function DayByDay() {
  const [lang] = useUiLang();
  const [theme, setTheme] = useUiTheme();
  const tr = (key: I18nKey) => t(key, lang);
  const [view, setView] = useState<DailyView>();
  const [message, setMessage] = useState<I18nKey>();
  const [text, setText] = useState("");
  const current = useRef<DailyView | undefined>(undefined);
  const busy = useRef(false);
  const [report, setReport] = useState("");
  const [acknowledgement, setAcknowledgement] = useState<{ rev: number; text: string }>();
  const [partial, setPartial] = useState("");
  const [mic, setMic] = useState<"off" | "opening" | "live">("off");
  const capture = useRef<{ id: string; session: string; release: () => void } | null>(null);
  const stop = useCallback(() => {
    const owner = capture.current;
    capture.current = null;
    if (owner) {
      owner.release();
      void desktopBridge()?.daily?.control("disarm", { session: owner.session, capture: owner.id }).catch(() => {});
    }
    setMic("off");
    setPartial("");
  }, []);
  const accept = useCallback((next: DailyView) => {
    current.current = next;
    setView(next);
    if (next.status) setMessage(`daily.${next.status}`);
  }, []);
  useEffect(() => {
    const bridge = desktopBridge()?.daily;
    if (!bridge) { setMessage("daily.desktop"); return; }
    let active = true;
    let session = "";
    const close = () => { if (session) void bridge.control("close", { session }).catch(() => {}); };
    void bridge.control("open").then(next => {
      session = next.session;
      if (active) accept(next);
      else close();
    }).catch(() => { if (active) setMessage("daily.error"); });
    const refresh = () => {
      if (!session || busy.current) return;
      const previous = current.current;
      void bridge.control("state", { session }).then(next => {
        if (active && current.current === previous && !busy.current) accept(next);
      }).catch(() => { if (active) setMessage("daily.error"); });
    };
    const unsubscribe = bridge.onSpeech(event => {
      if (!active || event.session !== session || event.capture !== capture.current?.id) return;
      if (event.error || event.stopped) {
        stop();
        if (event.error) setMessage("daily.micError");
      } else {
        setPartial(event.partial || "");
        if (event.status) setMessage(`daily.${event.status}`);
        if (event.final) refresh();
      }
    });
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    const clock = setInterval(refresh, 1000);
    return () => {
      active = false;
      stop(); unsubscribe(); clearInterval(clock); close(); current.current = undefined;
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [accept, stop]);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    const from = view;
    const bridge = desktopBridge()?.daily;
    if (!from || !bridge || busy.current) return;
    busy.current = true;
    try {
      const next = await bridge.control(action, { session: from.session, day: from.day, version: from.version, op: crypto.randomUUID(), ...extra });
      if (current.current?.session !== from.session) return;
      accept(next);
      if (next.ack) {
        const id = next.ack.id;
        const task = next.tasks.find(item => item.id === id) ?? from.tasks.find(item => item.id === id);
        setAcknowledgement({ rev: next.version, text: task?.text || "" });
        if (action === "confirm" || action === "undo") requestAnimationFrame(() => {
          const control = document.querySelector<HTMLInputElement>(`li[data-id="${CSS.escape(id)}"] input[type="checkbox"]`)
            ?? document.querySelector<HTMLInputElement>(".daily-entry input");
          control?.focus();
        });
      }
      return next;
    } catch { setMessage("daily.error"); }
    finally { busy.current = false; }
  }

  async function talk() {
    if (capture.current) { stop(); return; }
    const bridge = desktopBridge()?.daily;
    const from = current.current;
    if (!bridge || !from) return;
    const owner = { id: crypto.randomUUID(), session: from.session, release: () => {} };
    capture.current = owner;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let graph: ReturnType<typeof floatMicNode> | undefined;
    const failed = () => { if (capture.current === owner) { stop(); setMessage("daily.micError"); } };
    owner.release = () => {
      graph?.disconnect();
      stream?.getTracks().forEach(track => { track.removeEventListener("ended", failed); track.stop(); });
      if (context && context.state !== "closed") void context.close().catch(() => {});
    };
    setMic("opening"); setMessage(undefined);
    try {
      const armed = await bridge.control("arm", { session: from.session, day: from.day, version: from.version, capture: owner.id, language: lang });
      if (capture.current !== owner) return;
      if (armed.status === "stale") { stop(); accept(armed); return; }
      stream = await openSelectedMic({ channelCount: 1, echoCancellation: true });
      if (capture.current !== owner) { owner.release(); return; }
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== "live") { failed(); return; }
      track.addEventListener("ended", failed);
      context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      if (capture.current !== owner) return;
      graph = floatMicNode(context, context.createMediaStreamSource(stream), samples => {
        if (capture.current !== owner || track.readyState !== "live" || context?.state !== "running") return;
        bridge.feed(from.session, owner.id, samples);
        setMic("live");
      });
      await graph.ready;
    } catch { failed(); }
  }

  const done = view?.tasks.filter(row => row.done).length ?? 0;
  return <main className="daily" lang={lang}>
    <header className="daily-header"><Link className="btn" href="/">{tr("daily.back")}</Link><ThemeSwitch pref={theme} onChange={setTheme} /></header>
    <h1>{tr("daily.title")}</h1>
    {view && <>
      <nav className="controls" aria-label={tr("daily.title")}>{(["daily.today", "daily.tomorrow"] as const).map((key, i) =>
        <button className="btn" key={key} aria-pressed={view.offset === i} onClick={() => { stop(); void act("day", { offset: i }); }}>{tr(key)}</button>)}</nav>
      <h2><time dateTime={view.day}>{new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(new Date(view.day + "T12:00:00"))}</time></h2>
      <form className="daily-entry" onSubmit={async e => {
        e.preventDefault();
        if ((await act("create", { text }))?.ack) setText("");
      }}>
        <label>{tr("daily.task")}<input maxLength={2000} value={text} onChange={e => setText(e.target.value)} /></label>
        <button className="btn primary" disabled={!text.trim()}>{tr("daily.add")}</button>
      </form>
      <form className="daily-entry" onSubmit={async e => {
        e.preventDefault(); await act("review", { text: report });
      }}>
        <label>{tr("daily.report")}<input value={report} maxLength={2000} onChange={e => setReport(e.target.value)} /></label>
        <button className="btn" disabled={!report.trim()}>{tr("daily.review")}</button>
      </form>
      <div className="controls"><button className="btn" data-daily-talk aria-pressed={mic !== "off"} onClick={() => void talk()}>{tr(mic === "off" ? "daily.talk" : "daily.stop")}</button>
        <span role="status" data-mic={mic}>{tr(`daily.${mic}`)}</span></div>
      {partial && <p>{partial}</p>}
      {view.review && <section className="daily-review" key={view.review.token} aria-live="polite">
        <h3>{tr(view.review.type === "create" ? "daily.draft" : view.review.which ? "daily.which" : "daily.review")}</h3>
        <blockquote>{view.review.words}</blockquote>
        {view.review.type === "create" ? <form className="daily-entry" onSubmit={e => {
          e.preventDefault();
          void act("confirm", { token: view.review?.token, text: new FormData(e.currentTarget).get("draft") });
        }}>
          <label>{tr("daily.task")} · {new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(new Date(view.review.due + "T12:00:00"))}
            <input name="draft" required maxLength={2000} defaultValue={view.review.text} /></label>
          <button className="btn">{tr("daily.add")}</button>
        </form> : view.review.targets.map(task => <button className="btn" key={task.id} onClick={() =>
          void act("confirm", { token: view.review?.token, id: task.id })}>{tr(view.review?.type === "complete" ? "daily.complete" : "daily.reopen")} · {task.text}</button>)}
        <button className="btn" onClick={() => void act("dismiss", { token: view.review?.token })}>{tr("daily.dismiss")}</button>
      </section>}
      <p>{view.tasks.length ? t("daily.summary", lang, { open: view.tasks.length - done, done }) : tr("daily.empty")}</p>
      <ul className="daily-list">{view.tasks.map(row => <TaskRow key={row.id} row={row} tr={tr} act={act} />)}</ul>
      <details key={view.session + view.version} className="daily-clear">
        <summary>{tr("daily.clear")}</summary>
        <p>{tr("daily.clearConfirm")}</p>
        <button className="btn" onClick={() => void act("clear")}>{tr("daily.clear")}</button>
      </details>
    </>}
    <p role="status" aria-live="polite" aria-atomic="true"><span key={acknowledgement?.rev}>{message && tr(message)}{message === "daily.saved" && acknowledgement && " · " + acknowledgement.text}</span></p>
  </main>;
}

function TaskRow({ row, tr, act }: { row: DailyTask; tr: (key: I18nKey) => string;
  act: (action: string, data: Record<string, unknown>) => Promise<DailyView | undefined> }) {
  const [edit, setEdit] = useState({ rev: row.rev, text: row.text });
  const text = edit.rev === row.rev ? edit.text : row.text;
  const target = { id: row.id, rev: row.rev };
  return <li data-id={row.id} data-revision={row.rev}>
    <label className="daily-check"><input type="checkbox" checked={row.done} onChange={() => void act(row.done ? "reopen" : "complete", target)} />
      <span>{row.text}</span></label>
    <form className="daily-entry" onSubmit={e => { e.preventDefault(); void act("edit", { ...target, text }); }}>
      <label><span className="sr-only">{tr("daily.task")} · {row.text}</span>
        <input value={text} maxLength={2000} onChange={e => setEdit({ rev: row.rev, text: e.target.value })} /></label>
      <button className="btn" disabled={!text.trim() || text === row.text}>{tr("daily.rename")}</button>
    </form>
    <div className="controls">
      {(row.evidence || row.done) && <details><summary>{tr("daily.evidence")}</summary><p>{row.evidence || tr("daily.manual")}</p></details>}
      {row.undo && <button className="btn" aria-label={tr("daily.undo") + " · " + row.text} onClick={() => void act("undo", target)}>{tr("daily.undo")}</button>}
      <button className="btn" aria-label={tr("daily.delete") + " · " + row.text} onClick={() => void act("delete", target)}>{tr("daily.delete")}</button>
    </div>
  </li>;
}
