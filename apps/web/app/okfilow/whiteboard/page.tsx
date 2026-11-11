"use client";
// The whiteboard tutor (docs/whiteboard/SPEC.md): ask about a hard concept and OK Filow explains it
// on a board, one step at a time, drawn here and spoken with the voice chosen in OK Filow.
// Local by default. Cloud only when chosen on this page, and then only through the same notice,
// consent and going-outside signal as every other OK Filow question (lib/buddy/outboundClient.ts).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { useLang } from "@filow/ui";
import "katex/dist/katex.min.css";
import { okFilowBridge, type OkFilowStatus } from "@/lib/buddy/bridge";
import { okfText, OLLAMA_STOPPED_ANSWER, type OkfKey } from "@/lib/buddy/text";
import { askRoute, askRouteRecipient, changesStored, type AskRoute, type BuddyRecipients, type NoticeRequest, type OutboundSnapshot, type Recipient } from "@/lib/buddy/outbound";
import { createOutboundController, type OutboundController } from "@/lib/buddy/outboundClient";
import { createSpeaker } from "@/lib/buddy/voice";
import { freellmCodeOf, localizeFreeLlmError } from "@/lib/freellm";
import { getSetupPreference } from "@/lib/prefs";
import { Board, BOARD_PALETTES } from "@/components/whiteboard/Board";
import { initialLesson, lessonReducer, readLessonStream } from "@/lib/whiteboard/client";
import { boardPng, fileStem, saveBlob } from "@/lib/whiteboard/export";
import { layoutBoard, type BoardShape } from "@/lib/whiteboard/layout";
import { LIMITS, lessonMarkdown, validateLesson } from "@/lib/whiteboard/lesson";
import { initialPlayer, playerReducer, readingMs } from "@/lib/whiteboard/player";
import { wbText, type WbKey } from "@/lib/whiteboard/text";
import { OutboundNoticeModal, OutboundPill } from "../outbound-ui";
import "../outbound.css";
import "./whiteboard.css";

const REPLAY_KEY = "filow.whiteboard.replay";
const EXAMPLES: WbKey[] = ["example1", "example2", "example3", "example4"];

export default function WhiteboardPage() {
  const lang = useLang();
  const t = useCallback((k: WbKey, values?: Record<string, string | number>) => wbText(lang, k, values), [lang]);
  const okfT = useCallback((k: OkfKey) => okfText(lang)(k), [lang]);

  const [status, setStatus] = useState<OkFilowStatus | null>(null);
  const statusRef = useRef<OkFilowStatus | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [question, setQuestion] = useState("");
  const [follow, setFollow] = useState("");
  const [from, setFrom] = useState<AskRoute>("local");
  const [voiceOn, setVoiceOn] = useState(true);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<NoticeRequest | null>(null);
  const [snap, setSnap] = useState<OutboundSnapshot | null>(null);
  const [shape, setShape] = useState<BoardShape>("wide");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [ls, dispatchLesson] = useReducer(lessonReducer, initialLesson);
  const [player, dispatchPlayer] = useReducer(playerReducer, initialPlayer);
  const lsRef = useRef(ls);
  lsRef.current = ls;
  const playerRef = useRef(player);
  playerRef.current = player;

  const abortRef = useRef<AbortController | null>(null);
  const askSeq = useRef(0);
  const lastAsk = useRef<{ text: string; more: boolean } | null>(null);
  const jumpTo = useRef<number | null>(null);
  const token = useRef<string | null>(null);
  const turnRef = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  /** When each step's data arrived while the board was waiting for it, to measure how fast it shows. */
  const arrived = useRef(new Map<number, number>());
  const [shownMs, setShownMs] = useState<number | null>(null);

  const engineHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const b = okFilowBridge();
    if (!b?.accessPassword) return {};
    if (!token.current) {
      const res = await fetch(`${b.sessionUrl}/api/session`, { method: "POST", headers: { "X-Access-Password": b.accessPassword } });
      if (res.ok) token.current = ((await res.json()) as { engineToken?: string }).engineToken ?? null;
    }
    return token.current ? { Authorization: `Bearer ${token.current}` } : {};
  }, []);

  // Nothing carrying the user's words leaves this window except through this controller: it asks
  // before the first send to each recipient, adds the header the server checks, and drives the signal.
  const outRef = useRef<OutboundController | null>(null);
  if (!outRef.current) {
    outRef.current = createOutboundController({
      consent: () => statusRef.current?.consent,
      save: async (_next, also, changes) => {
        const b = okFilowBridge();
        if (!b) return false;
        const s = await b.configure({ consentChanges: changes, ...also });
        statusRef.current = s;
        setStatus(s);
        return changesStored(s.consent ?? {}, changes);
      },
      fetchRecipients: async () => {
        const res = await fetch("/api/buddy/recipients", { headers: await engineHeaders() });
        return res.ok ? ((await res.json()) as BuddyRecipients) : null;
      },
      signal: {
        begin: (id, kind, names) => okFilowBridge()?.outbound?.begin(id, kind, names),
        end: (id, o) => okFilowBridge()?.outbound?.end(id, o),
      },
      onNotice: setNotice,
    });
  }
  const out = outRef.current;

  const langRef = useRef(lang);
  langRef.current = lang;
  // The voices of OK Filow (natural on this PC, the system voice). No cloud voice from this page:
  // without `cloudAudio` the speaker falls back to the system voice and sends nothing.
  const speaker = useMemo(() => createSpeaker({ bridge: okFilowBridge, status: () => statusRef.current, isCurrent: (id) => turnRef.current === id, uiLang: () => langRef.current }), []);

  const ask = useCallback(async (raw: string, more: boolean) => {
    const text = raw.trim().slice(0, LIMITS.question);
    const current = lsRef.current.lesson;
    if (!text || (more && !current)) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const id = ++askSeq.current;
    lastAsk.current = { text, more };
    setNote("");
    arrived.current.clear();
    dispatchLesson({ type: "ask", more });
    jumpTo.current = more ? current!.steps.length : null;
    if (!more) dispatchPlayer({ type: "reset", expected: 0 });
    try {
      // Offline mode always means this PC; otherwise what was chosen on this page.
      let route: AskRoute = statusRef.current?.offline ? "local" : from;
      let to: Recipient | null = null;
      if (route !== "local") {
        if (!okFilowBridge()) {
          route = "local";
          setNote(wbText(langRef.current, "cloudNeedsApp"));
        } else {
          const all = await out.recipients();
          // who receives the question on this route: OpenRouter and the model's maker, or the user's FreeLLMAPI router
          const target = all ? askRouteRecipient(route, all) : null;
          if (!target) throw new Error(okfT("noticeUnknown"));
          const rec = { ask: target };
          if (out.standing("ask", rec.ask) === "ask") setNote(wbText(langRef.current, "noticeWaiting"));
          const decision = await out.allow("ask", rec.ask);
          if (askSeq.current !== id) return;
          setNote("");
          if (decision === "dismissed") return dispatchLesson({ type: "cancel" });
          if (decision === "declined") {
            route = "local";
            setNote(wbText(langRef.current, "keptLocal"));
          } else to = rec.ask;
        }
      }
      const send = async (consent: Record<string, string>, quiet?: () => void) => {
        const res = await fetch("/api/whiteboard/lesson", {
          method: "POST",
          signal: abort.signal,
          headers: { "Content-Type": "application/json", ...(await engineHeaders()), ...consent },
          body: JSON.stringify({ question: text, provider: route, setup: getSetupPreference(), language: more ? lsRef.current.meta?.lang ?? "auto" : "auto", lesson: more ? current : undefined }),
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { code: j.code || "model" });
        }
        // The server answered from this PC after all (offline switch): nothing went outside.
        if (res.headers.get("X-Buddy-Provider") === "local") quiet?.();
        let ended = false;
        await readLessonStream(res.body, (event) => {
          if (askSeq.current !== id) return;
          if (event.type === "done" || event.type === "error") ended = true;
          if (event.type === "step") {
            const p = playerRef.current;
            const index = lsRef.current.base + event.index;
            if (p.phase === "waiting" && p.playing && p.index + 1 === index) arrived.current.set(index, performance.now());
          }
          dispatchLesson({ type: "event", event });
        });
        // The answer stopped without saying it was done (the server went away): do not wait forever.
        if (!ended && askSeq.current === id) throw new Error("the answer stopped before the lesson was complete");
      };
      await (to ? out.sending("ask", to, send) : send({}));
    } catch (e) {
      if (abort.signal.aborted || askSeq.current !== id) return;
      dispatchLesson({ type: "fail", code: (e as { code?: string }).code ?? "model", message: e instanceof Error ? e.message : String(e) });
    }
  }, [engineHeaders, from, okfT, out]);
  const askRef = useRef(ask);
  askRef.current = ask;

  // The desktop bridge: settings, the going-outside signal, and topics sent from the OK Filow panel.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("voice") === "off") setVoiceOn(false);
    // A saved lesson handed to this window (tools/whiteboard/shots.mjs puts one in sessionStorage to
    // photograph its final board): checked like anything a model wrote, shown silently at its last step.
    try {
      const saved = window.sessionStorage.getItem(REPLAY_KEY);
      window.sessionStorage.removeItem(REPLAY_KEY);
      const lesson = saved ? validateLesson(JSON.parse(saved), { maxSteps: 12, sketch: true }) : null;
      if (lesson) {
        setVoiceOn(false);
        dispatchLesson({ type: "ask", more: false });
        dispatchPlayer({ type: "reset", expected: 0 });
        dispatchLesson({ type: "event", event: { type: "start", provider: "local", model: "saved lesson", lang: "en", lite: false, more: false } });
        dispatchLesson({ type: "event", event: { type: "outline", title: lesson.title, scene: lesson.scene, says: lesson.steps.map((s) => s.say) } });
        lesson.steps.forEach((step, index) => dispatchLesson({ type: "event", event: { type: "step", index, step } }));
        dispatchLesson({ type: "event", event: { type: "done", cards: lesson.steps.filter((s) => s.card).length, stalled: false } });
        jumpTo.current = lesson.steps.length - 1;
        return;
      }
    } catch { /* not a lesson: the page opens as usual */ }
    const q = params.get("q");
    const b = okFilowBridge();
    if (!b) {
      if (q) {
        setQuestion(q);
        void askRef.current(q, false);
      }
      return;
    }
    setDesktop(true);
    const apply = (s: OkFilowStatus) => {
      statusRef.current = s;
      setStatus(s);
    };
    void b.status().then((s) => {
      apply(s);
      // the whiteboard starts on the source OK Filow answers from: this PC, FreeLLMAPI or Cloud
      setFrom(askRoute(s));
      if (s.voice === "off") setVoiceOn(false);
    }).catch(() => {});
    const offs = [b.onConfig(apply)];
    if (b.outbound) {
      offs.push(b.outbound.onChange(setSnap));
      b.outbound.ready();
    }
    if (b.onWhiteboard) {
      offs.push(b.onWhiteboard((topic) => {
        if (typeof topic !== "string" || !topic.trim()) return;
        setQuestion(topic.trim());
        void askRef.current(topic, false);
      }));
    }
    b.whiteboardReady?.();
    return () => { for (const off of offs) off(); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const narrow = window.matchMedia("(max-width: 700px)");
    const size = () => setShape(narrow.matches ? "tall" : "wide");
    size();
    narrow.addEventListener("change", size);
    return () => {
      watch.disconnect();
      narrow.removeEventListener("change", size);
    };
  }, []);

  // The player follows the lesson as it arrives.
  const stepCount = ls.lesson?.steps.length ?? 0;
  useEffect(() => {
    dispatchPlayer({ type: "arrived", total: stepCount });
    dispatchPlayer({ type: "expect", expected: ls.expected });
    if (jumpTo.current !== null && stepCount > jumpTo.current) {
      dispatchPlayer({ type: "goto", index: jumpTo.current });
      jumpTo.current = null;
    }
  }, [stepCount, ls.expected]);

  // One step: speak its sentence (or give it reading time), then tell the player it is done.
  const say = player.index >= 0 ? ls.lesson?.steps[player.index]?.say ?? "" : "";
  const lessonLang = ls.meta?.lang;
  const speaking = player.phase === "showing" && player.playing;
  useEffect(() => {
    if (!speaking) return;
    const turn = player.turn;
    turnRef.current = turn;
    let over = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { if (!over) dispatchPlayer({ type: "spoken", turn }); };
    if (voiceOn && say) {
      const started = performance.now();
      void speaker.speak(say, turn, { lang: lessonLang }).catch(() => {}).then(() => {
        if (over) return;
        // No voice spoke (none installed, or it failed at once): leave time to read instead.
        timer = setTimeout(finish, performance.now() - started < 500 ? readingMs(say) : 450);
      });
    } else timer = setTimeout(finish, readingMs(say));
    return () => {
      over = true;
      clearTimeout(timer);
      speaker.stop();
    };
  }, [speaking, player.turn, say, voiceOn, lessonLang, speaker]);

  // How long after its data arrived a step was on the board (only when the board was waiting for it).
  useEffect(() => {
    const at = arrived.current.get(player.index);
    if (at === undefined) return;
    arrived.current.delete(player.index);
    // An effect runs once the step's SVG is in the document (the paint follows in the same frame).
    // Not requestAnimationFrame: that waits for as long as the window is hidden.
    setShownMs(Math.round(performance.now() - at));
  }, [player.index, player.turn]);

  useEffect(() => () => {
    abortRef.current?.abort();
    speaker.stop();
  }, [speaker]);

  const layout = useMemo(() => (ls.lesson && player.index >= 0 ? layoutBoard(ls.lesson, player.index, shape) : null), [ls.lesson, player.index, shape]);
  const busy = ls.phase === "planning" || ls.phase === "drawing";
  const lite = Boolean(ls.meta?.lite);
  const offline = Boolean(status?.offline);

  const onAsk = (ev: FormEvent) => {
    ev.preventDefault();
    void ask(question, false);
  };
  const onFollow = (ev: FormEvent) => {
    ev.preventDefault();
    const text = follow;
    setFollow("");
    void ask(text, true);
  };
  const savePng = async () => {
    const svg = frame.current?.querySelector<SVGSVGElement>("svg.wb-board");
    if (!svg || !ls.lesson) return;
    try {
      saveBlob(await boardPng(svg), `${fileStem(ls.lesson.title)}.png`);
      setNote(t("saved"));
    } catch {
      setNote(t("exportFailed"));
    }
  };
  const saveMd = () => {
    if (!ls.lesson) return;
    saveBlob(new Blob([lessonMarkdown(ls.lesson, { step: t("mdStep"), drawing: t("mdBoard") })], { type: "text/markdown;charset=utf-8" }), `${fileStem(ls.lesson.title)}.md`);
    setNote(t("saved"));
  };
  const retry = (viaCloud: boolean) => {
    const last = lastAsk.current;
    if (!last) return;
    if (viaCloud) {
      // the user's own press: the next ask goes through the notice like any cloud question
      setFrom("cloud");
      setTimeout(() => void askRef.current(last.text, last.more), 0);
    } else void ask(last.text, last.more);
  };

  const status_line = ls.phase === "planning" ? t("planning") : ls.phase === "drawing" && stepCount < ls.expected ? t("drawingStep", { n: stepCount + 1, total: ls.expected }) : "";
  const errorText = !ls.error ? "" : ls.error.code === "plan" ? t("errPlan") : ls.error.code === "stalled" ? t("errStalled") : ls.error.code === "no_local_helper" ? ls.error.message : OLLAMA_STOPPED_ANSWER.test(ls.error.message) ? okfT("ollamaStopped") : ls.error.code.startsWith("freellm") || freellmCodeOf(ls.error.message) ? localizeFreeLlmError(ls.error.message, lang) : t("errGeneric", { message: ls.error.message });

  return (
    <main className={`wb-page${lite ? " wb-plain" : ""}`} data-phase={ls.phase} data-player={player.phase} data-shown-ms={shownMs ?? undefined}>
      <header className="wb-head">
        <h1>{t("title")}</h1>
        {ls.meta && <span className="wb-chip" data-source={ls.meta.provider}>{t(ls.meta.provider === "cloud" ? "source_cloud" : ls.meta.provider === "freellm" ? "source_free" : "source_local", { model: ls.meta.model })}</span>}
        {snap?.active && <OutboundPill snap={snap} t={okfT} />}
        <span className="wb-grow" />
        {desktop && <button type="button" className="wb-btn small" onClick={() => okFilowBridge()?.closeWhiteboard?.()}>{t("close")}</button>}
      </header>

      <form className="wb-ask" onSubmit={onAsk}>
        <label className="wb-field">
          {t("askLabel")}
          <input type="text" value={question} maxLength={LIMITS.question} placeholder={t("askPlaceholder")} onChange={(e) => setQuestion(e.target.value)} autoComplete="off" />
        </label>
        <fieldset className="wb-from">
          <legend>{t("fromLabel")}</legend>
          <span className="wb-seg">
            <label><input type="radio" name="wb-from" checked={from === "local" || offline} onChange={() => setFrom("local")} />{t("from_local")}</label>
            <label title={!desktop ? t("cloudNeedsApp") : offline ? t("cloudOffline") : t("onlyQuestion")}>
              <input type="radio" name="wb-from" checked={from === "freellm" && !offline} disabled={!desktop || offline} onChange={() => setFrom("freellm")} />{t("from_free")}
            </label>
            <label title={!desktop ? t("cloudNeedsApp") : offline ? t("cloudOffline") : t("onlyQuestion")}>
              <input type="radio" name="wb-from" checked={from === "cloud" && !offline} disabled={!desktop || offline} onChange={() => setFrom("cloud")} />{t("from_cloud")}
            </label>
          </span>
        </fieldset>
        <button type="submit" className="wb-btn primary" disabled={!question.trim()}>{t("explain")}</button>
      </form>
      {from !== "local" && !offline && desktop && <p className="wb-note">{t("onlyQuestion")}{from === "freellm" ? ` ${okfT("outFreeWarn")}` : ""}</p>}
      {offline && <p className="wb-note">{t("cloudOffline")}</p>}

      {!ls.lesson && !busy && !ls.error && (
        <div className="wb-try">
          <span>{t("tryLabel")}</span>
          {EXAMPLES.map((k) => (
            <button key={k} type="button" className="wb-btn small" onClick={() => { setQuestion(t(k)); void ask(t(k), false); }}>{t(k)}</button>
          ))}
        </div>
      )}

      <p className="wb-note" role="status" aria-live="polite">{[status_line, note].filter(Boolean).join(" ")}</p>

      {ls.error && (
        <div className="wb-alert" role="alert">
          <p>{errorText}</p>
          <button type="button" className="wb-btn small" onClick={() => retry(false)}>{t("retry")}</button>
          {desktop && !offline && from !== "cloud" && <button type="button" className="wb-btn small" onClick={() => retry(true)}>{t("useCloud")}</button>}
        </div>
      )}

      <section className="wb-stage" aria-label={t("title")}>
        <div className="wb-frame" ref={frame} style={layout ? { background: BOARD_PALETTES[theme].board } : undefined}>
          {layout ? (
            <Board
              layout={layout}
              current={player.index}
              palette={BOARD_PALETTES[theme]}
              sketchy={!lite}
              label={t("boardLabel", { title: ls.lesson?.title ?? "" })}
              onPick={busy ? undefined : (_id, text) => void ask(t("againAsk", { name: text }), true)}
              pickLabel={(text) => t("nodeAgain", { name: text })}
            />
          ) : (
            <div className="wb-empty">{busy ? t("planning") : t("intro")}</div>
          )}
        </div>

        {ls.lesson && (
          <>
            <div className="wb-progress" aria-hidden="true"><span style={{ width: `${Math.round(((player.index + 1) / Math.max(1, ls.expected, stepCount)) * 100)}%` }} /></div>
            <p className="wb-say" aria-live="polite">
              <span className="wb-count">
                {player.index >= 0 ? t("stepOf", { n: player.index + 1, total: Math.max(ls.expected, stepCount) }) : ""}
                {player.phase === "waiting" && stepCount > 0 ? ` ${t("waitingStep")}` : ""}
                {player.phase === "done" ? ` ${t("ended")}` : ""}
              </span>
              {say}
            </p>
            <div className="wb-controls">
              <button type="button" className="wb-btn" onClick={() => dispatchPlayer({ type: "back" })} disabled={player.index <= 0}>{t("back")}</button>
              <button type="button" className="wb-btn primary" onClick={() => dispatchPlayer({ type: player.playing ? "pause" : "play" })} disabled={stepCount === 0}>{player.playing ? t("pause") : t("play")}</button>
              <button type="button" className="wb-btn" onClick={() => dispatchPlayer({ type: "next" })} disabled={player.index + 1 >= stepCount}>{t("next")}</button>
              <button type="button" className="wb-btn" onClick={() => dispatchPlayer({ type: "replay" })} disabled={player.index < 0}>{t("replay")}</button>
              <button type="button" className="wb-btn" aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)}>{voiceOn ? t("voiceOn") : t("voiceOff")}</button>
              <span className="wb-grow" />
              <button type="button" className="wb-btn" onClick={() => void savePng()} disabled={!layout}>{t("exportPng")}</button>
              <button type="button" className="wb-btn" onClick={saveMd} disabled={stepCount === 0}>{t("exportMd")}</button>
            </div>
            {/* The local model explains correctly but its boards miss the main relations too often (docs/whiteboard/PROOF.md, round 3): the page says so. Never a switch: only words. */}
            {ls.meta?.provider === "local" && <p className="wb-note" data-advice="cloud">{t("localSimple")}</p>}
            {lite && <p className="wb-note">{t("liteNote")}</p>}
            {ls.stalled && <p className="wb-note">{t("stalledNote")}</p>}
            {!ls.stalled && ls.cards > 0 && <p className="wb-note">{t("cardsNote", { n: ls.cards })}</p>}
            {layout && layout.wiped > 0 && <p className="wb-note">{t("wipedNote", { n: layout.wiped })}</p>}
            {!busy && layout && layout.nodes.length > 0 && <p className="wb-note">{t("againHint")}</p>}
            {!busy && (
              <form className="wb-ask" onSubmit={onFollow}>
                <label className="wb-field">
                  {t("followLabel")}
                  <input type="text" value={follow} maxLength={LIMITS.question} placeholder={t("followPlaceholder")} onChange={(e) => setFollow(e.target.value)} autoComplete="off" />
                </label>
                <button type="submit" className="wb-btn" disabled={!follow.trim()}>{t("followSend")}</button>
              </form>
            )}
          </>
        )}
      </section>

      {notice && <OutboundNoticeModal key={`${notice.kind}:${notice.recipient.id}`} notice={notice} t={okfT} more={`${t("noticeScope")} ${okfT("noticeRemember")}`} onDecide={(d) => void out.decide(d)} />}
    </main>
  );
}
