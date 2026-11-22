"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
    const clock = setInterval(refresh, 1000);
    return () => { active = false; clearInterval(clock); close(); current.current = undefined; };
  }, [accept]);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    const from = view;
    const bridge = desktopBridge()?.daily;
    if (!from || !bridge || busy.current) return;
    busy.current = true;
    try {
      const next = await bridge.control(action, { session: from.session, day: from.day, version: from.version, op: crypto.randomUUID(), ...extra });
      if (current.current?.session !== from.session) return;
      accept(next);
      return next;
    } catch { setMessage("daily.error"); }
    finally { busy.current = false; }
  }

  const done = view?.tasks.filter(row => row.done).length ?? 0;
  return <main className="daily" lang={lang}>
    <header className="daily-header"><Link className="btn" href="/">{tr("daily.back")}</Link><ThemeSwitch pref={theme} onChange={setTheme} /></header>
    <h1>{tr("daily.title")}</h1>
    {view && <>
      <nav className="controls" aria-label={tr("daily.title")}>{(["daily.today", "daily.tomorrow"] as const).map((key, i) =>
        <button className="btn" key={key} aria-pressed={view.offset === i} onClick={() => void act("day", { offset: i })}>{tr(key)}</button>)}</nav>
      <h2><time dateTime={view.day}>{new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(new Date(view.day + "T12:00:00"))}</time></h2>
      <form className="daily-entry" onSubmit={async e => {
        e.preventDefault();
        if ((await act("create", { text }))?.ack) setText("");
      }}>
        <label>{tr("daily.task")}<input maxLength={2000} value={text} onChange={e => setText(e.target.value)} /></label>
        <button className="btn primary" disabled={!text.trim()}>{tr("daily.add")}</button>
      </form>
      <p>{view.tasks.length ? t("daily.summary", lang, { open: view.tasks.length - done, done }) : tr("daily.empty")}</p>
      <ul className="daily-list">{view.tasks.map(row => <TaskRow key={row.id + "/" + row.rev} row={row} tr={tr} act={act} />)}</ul>
    </>}
    <p role="status" aria-live="polite">{message && tr(message)}</p>
  </main>;
}

function TaskRow({ row, tr, act }: { row: DailyTask; tr: (key: I18nKey) => string;
  act: (action: string, data: Record<string, unknown>) => Promise<DailyView | undefined> }) {
  const [text, setText] = useState(row.text);
  const target = { id: row.id, rev: row.rev };
  return <li data-id={row.id} data-revision={row.rev}>
    <label className="daily-check"><input type="checkbox" checked={row.done} onChange={() => void act(row.done ? "reopen" : "complete", target)} />
      <span>{row.text}</span></label>
    <form className="daily-entry" onSubmit={e => { e.preventDefault(); void act("edit", { ...target, text }); }}>
      <label><span className="sr-only">{tr("daily.task")} · {row.text}</span>
        <input value={text} maxLength={2000} onChange={e => setText(e.target.value)} /></label>
      <button className="btn" disabled={!text.trim() || text === row.text}>{tr("daily.rename")}</button>
    </form>
    <div className="controls">
      {(row.evidence || row.done) && <details><summary>{tr("daily.evidence")}</summary><p>{row.evidence || tr("daily.manual")}</p></details>}
      {row.undo && <button className="btn" aria-label={tr("daily.undo") + " · " + row.text} onClick={() => void act("undo", target)}>{tr("daily.undo")}</button>}
    </div>
  </li>;
}
