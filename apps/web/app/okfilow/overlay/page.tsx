"use client";
// OK Filow overlay: one transparent, click-through window per display. Draws the buddy dot next to
// the mouse, the waveform while listening, a spinner while thinking, the answer bubble, and flies
// the dot along a curve to the things the answer points at. The bubble (components/okfilow/bubble.tsx,
// docs/okfilow/BUBBLE.md) shows the whole answer, holds still when the pointer comes to it, and goes
// away when main says so (its time is up, Escape, its close button).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@filow/ui";
import { okFilowBridge, type OkFilowCard, type OkFilowMode } from "@/lib/buddy/bridge";
import { bubbleOnScreen, bubblePlacement, bubbleSticks, createPausableClock, followScroll, MARK_EXIT_MS, marksBegun, overBubble, overControls } from "@/lib/buddy/motion";
import { planFlight, flightPoint, arrivalPhase, type FlightPlan } from "@/lib/buddy/pointer-flight";
import { drawingStarts } from "@/lib/buddy/marks-sync";
import { MarksLayer, type MarkSet } from "@/components/okfilow/marks-layer";
import { CardsLayer } from "@/components/okfilow/cards-layer";
import type { Rect } from "@/lib/buddy/marks";
import { keyLabel, PILL_IDLE, pillView, statusRoom, talkHeld, type PillAction, type PillState } from "@/lib/buddy/pill";
import { AnswerBubble, answerInBubble, markMore } from "@/components/okfilow/bubble";
import { AnswerControls, EyeButton, Slot } from "@/components/okfilow/controls";
import { joinNames, localNames, type OutboundSnapshot } from "@/lib/buddy/outbound";
import { okfText, type OkfKey } from "@/lib/buddy/text";
import { dictationText } from "@/lib/dictation/text";
import { OutboundIcon } from "../outbound-ui";
import "../okfilow.css";

const OFFSET = { x: 16, y: 20 };
/** The pointer's glyph (its tip at 3,2). */
const ARROW = "M3 2l17 8-7.5 2.2L10.4 20z";
const HOLD_MS = 5500;

type Target = { x: number; y: number; label: string };

export default function OkFilowOverlay() {
  const dot = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<OkFilowMode>("idle");
  const [purpose, setPurpose] = useState("talk");
  // This question took the screen with it (the eye on the pill), and the answer on screen was stopped by the user.
  const [sees, setSees] = useState(true);
  const [stopped, setStopped] = useState(false);
  const markStarts = useRef<number[]>([]);
  // The pill: its state (the eye now, paused, resumable: the panel says), its shortcuts, and whether the pointer is on one of its controls.
  const [pill, setPill] = useState<PillState>(PILL_IDLE);
  const [keys, setKeys] = useState({ eye: "", pause: "" });
  const pillSpot = useRef<HTMLDivElement>(null);
  const overStop = useRef(false);
  /** The flights and the pen are timed on this clock: it stands still while the answer is paused. */
  const clock = useRef(createPausableClock());
  /** Whether the pointer is on a control of the pill (the eye, Pause, Resume, Stop). */
  const onControl = useCallback((p: { x: number; y: number } | null) => overControls(p, Array.from(pillSpot.current?.querySelectorAll("button") ?? [], (el) => el.getBoundingClientRect())), []);
  /** Whether the pointer is on the answer bubble (only an answer's bubble on screen counts: it then stays, scrolls under the wheel and can be closed). */
  const onBubble = useCallback((p: { x: number; y: number } | null) => holds.current.answer && holds.current.shown && overBubble(p, bubble.current?.getBoundingClientRect() ?? null), []);
  /** Tells main where the pointer is among the things that take the mouse, when that changed (or always, with `force`). */
  const tellHover = useCallback((p: { x: number; y: number } | null, force = false) => {
    const overB = onBubble(p);
    const over = overB || onControl(p);
    if (!force && over === overStop.current && overB === holds.current.over) return;
    overStop.current = over;
    holds.current.over = overB;
    okFilowBridge()?.overlayHover?.(over, overB);
  }, [onBubble, onControl]);
  /** Something new is in the bubble: it is back, whatever sent it away before. */
  const reopen = useCallback(() => {
    if (wipe.current) clearTimeout(wipe.current);
    wipe.current = null;
    setClosed(false);
  }, []);
  const [text, setText] = useState("");
  // The bubble was sent away (main: its time is up, Escape, its close button) until something new is shown.
  const [closed, setClosed] = useState(false);
  const wipe = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The sentence the voice is on (the panel says): the bubble keeps it in view.
  const [spoken, setSpoken] = useState(-1);
  const textBox = useRef<HTMLDivElement>(null);
  /** What the frame loop needs to know about the bubble: an answer is in it and it is on screen; it has been placed; the pointer is on it. */
  const holds = useRef({ answer: false, shown: false, placed: false, over: false, at: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  const [level, setLevel] = useState(0);
  const [label, setLabel] = useState("");
  // Near the bottom or right edge the label goes above or to the left of the arrow, never off screen.
  const labelEl = useRef<HTMLSpanElement>(null);
  const ringEl = useRef<HTMLElement>(null);
  const targetEl = useRef<HTMLDivElement>(null);
  const pointAvoid = useRef<Rect[]>([]);
  const [here, setHere] = useState(false);
  // `done`: drawn before a stop (Resume after Stop): shown as it was, not drawn again.
  const [marks, setMarks] = useState<MarkSet>({ id: 0, list: [] });
  const marksNow = useRef(marks);
  marksNow.current = marks;
  // The marks going away (Clear, an empty drawing): kept for one exit, the labels fading and the strokes erasing.
  const [leaving, setLeaving] = useState<MarkSet | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cards, setCards] = useState<OkFilowCard[]>([]);
  // Highlighter: while the talk chord is held the overlay takes the mouse; a drag marks the screen.
  const [ink, setInk] = useState<Array<Array<[number, number]>>>([]);
  const live = useRef<Array<[number, number]> | null>(null);
  // Going outside: on while anything carrying the user's content is in flight (main decides).
  const [out, setOut] = useState<OutboundSnapshot>({ active: false, kinds: [], names: [] });
  const lang = useLang();
  const t = useCallback((k: OkfKey) => okfText(lang)(k), [lang]);
  const going = out.active && out.names.length > 0;

  const pos = useRef({ x: -100, y: -100 });
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const queue = useRef<Target[]>([]);
  const flight = useRef<{ plan: FlightPlan; to: Target; start: number; dur: number; holdUntil: number; arrived: boolean } | null>(null);
  // Arrivals of the pointer at a spot: each one plays the ring once.


  useEffect(() => {
    const b = okFilowBridge();
    if (!b) return;
    /** The marks on screen go away with an exit (only those the pen has begun; the rest were never seen). */
    const leave = () => {
      const m = marksNow.current;
      if (!m.list.length) return;
      const begun = marksBegun(markStarts.current, clock.current.at(performance.now()));
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setLeaving({ id: m.id, list: begun === m.list.length ? m.list : m.list.slice(0, begun), leaving: true });
      leaveTimer.current = setTimeout(() => { leaveTimer.current = null; setLeaving(null); }, MARK_EXIT_MS + 60);
    };
    const applyColor = (c?: string) => { if (c && /^#[0-9a-f]{6}$/i.test(c)) document.documentElement.style.setProperty("--okf-ink", c); };
    const applyKeys = (s: { eyeKey?: string; pauseKey?: string }) => setKeys({ eye: keyLabel(s.eyeKey), pause: keyLabel(s.pauseKey) });
    void b.status().then((s) => { applyColor(s.color); applyKeys(s); }).catch(() => {});
    const offs = [
      b.onConfig((s) => { applyColor(s.color); applyKeys(s); }),
      b.onPill?.((s) => setPill({ sees: s?.sees !== false, paused: s?.paused === true, resumable: s?.resumable === true })) ?? (() => {}),
      b.onStrokes(() => setInk([])),
      b.onState((s) => {
        setMode(s.mode);
        setPurpose(s.purpose ?? "talk");
        if (typeof s.sees === "boolean") setSees(s.sees);
        setStopped(s.stopped === true);
        // A question, a dictation or a stopped answer brings the bubble back; a new answer starts unspoken.
        if (s.mode === "listening" || s.mode === "thinking" || s.stopped === true) reopen();
        if (s.mode === "listening" || s.mode === "thinking") setSpoken(-1);
        if (s.stopped === true) {
          // Stop: the pointer flies nowhere else, and the marks not yet begun are not drawn (the ones on screen stay).
          queue.current = [];
          flight.current = null;
          setLabel("");
          const now = clock.current.at(performance.now());
          setMarks((m) => {
            return { ...m, list: m.list.slice(0, marksBegun(markStarts.current, now)) };
          });
        }
        if (s.mode !== "listening" && s.mode !== "opening" && live.current) {
          const l = live.current;
          live.current = null;
          if (l.length > 1) b.stroke(l);
        }
        // The marks go away once the answer is on its way; the model already has them in the screenshot.
        if (s.mode === "speaking" || s.mode === "idle" || s.mode === "error") setInk([]);
      }),
      b.onText((next) => {
        setText(next);
        if (next) reopen();
        else setSpoken(-1);
      }),
      // Main sends the bubble away: it fades with its words still in it, then is emptied.
      b.onBubbleClose?.(() => {
        setClosed(true);
        if (wipe.current) clearTimeout(wipe.current);
        wipe.current = setTimeout(() => { wipe.current = null; setText(""); setStopped(false); setSpoken(-1); }, 300);
      }) ?? (() => {}),
      b.onSpoken?.((n) => setSpoken(Number.isInteger(n) ? n : -1)) ?? (() => {}),
      b.outbound?.onChange(setOut) ?? (() => {}),
      b.onLevel(setLevel),
      b.onCursor((p) => {
        cursor.current = p;
        if (!flight.current && dot.current) dot.current.style.visibility = "";
        // The controls of the pill and the answer bubble are what takes the mouse here: while the pointer
        // is on one (main sends where the pointer is), this overlay asks main for the mouse, and gives it back after.
        tellHover(p);
      }),
      b.onDraw((list, texts = []) => {
        // Kept until main wipes them: an empty list when the answer's bubble goes, or okfilow:clear (Escape, the panel's Clear, the next question).
        const next = Array.isArray(list) ? list : [];
        if (!next.length) leave();
        const now = clock.current.at(performance.now());
        const m = marksNow.current;
        const timing = drawingStarts({ list: m.list, starts: markStarts.current }, next, now, next.filter(x => x.done).length);
        markStarts.current = timing.starts;
        const value = { id: timing.grew ? m.id : m.id + 1, texts, list: next.map((x, i) => timing.grew && m.list[i] ? m.list[i] : { ...x, delay: Math.max(0, timing.starts[i] - now) }) };
        marksNow.current = value;
        setMarks(value);
      }),
      b.onCards((list) => setCards(Array.isArray(list) ? list.slice(0, 2) : [])),
      b.onClear(() => {
        setCards([]);
        leave();
        setMarks((m) => (m.list.length ? { id: m.id + 1, list: [] } : m));
        queue.current = [];
        flight.current = null;
        setLabel("");
      }),
      b.onPoint((points, avoid = []) => {
        pointAvoid.current = avoid;
        queue.current = [...points];
        flight.current = null;
        setLabel("");
      }),
    ];
    // Listeners are in place: ask for the state sent while this page was still loading.
    b.overlayReady();
    let raf = 0;
    const tick = (real: number) => {
      // The flight is timed on the clock that stands still during a pause: the pointer freezes where it is.
      const now = clock.current.at(real);
      const f = flight.current;
      if (!f && queue.current.length) {
        const spot = queue.current.shift()!;
        const plan = planFlight(pos.current.x < 0 ? null : pos.current, spot, pointAvoid.current, { width: window.innerWidth, height: window.innerHeight }, Math.min(260, spot.label.length * 8.5 + 22));
        if (dot.current) dot.current.style.visibility = plan.overlap > 0 ? "hidden" : "";
        const dur = plan.duration;
        flight.current = { plan, to: spot, start: now, dur, holdUntil: now + dur + HOLD_MS, arrived: false };
        setLabel(spot.label);
      }
      const g = flight.current;
      if (targetEl.current) {
        const r = g?.plan.targetRect;
        targetEl.current.style.display = r && g?.plan.underline && now >= g!.start + g!.dur ? "block" : "none";
        if (r) Object.assign(targetEl.current.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${Math.max(0, r.right-r.left-18)}px`, height: `${r.bottom-r.top}px` });
      }
      if (!g && ringEl.current) ringEl.current.style.opacity = "0";
      let next: { x: number; y: number } | null = null;
      if (g) {
        const k = Math.min(1, (now - g.start) / g.dur);
        next = flightPoint(g.plan, k);
        if (dot.current) dot.current.dataset.landed = String(k >= 1);
        if (labelEl.current) {
          labelEl.current.style.left = `${g.plan.dock.x}px`;
          labelEl.current.style.top = `${g.plan.dock.y}px`;
        }
        if (ringEl.current) {
          const phase = arrivalPhase(now - g.start, g.dur, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
          ringEl.current.style.opacity = String(phase.opacity);
          ringEl.current.style.transform = `scale(${phase.scale})`;
        }
        if (now > g.holdUntil || (queue.current.length && now > g.start + g.dur + 1800)) { flight.current = null; setLabel(""); }
      } else if (cursor.current) {
        if (dot.current) dot.current.dataset.landed = "false";
        if (ringEl.current) ringEl.current.style.opacity = "0";
        const c = cursor.current;
        const want = { x: c.x + OFFSET.x, y: c.y + OFFSET.y };
        // Ease toward the pointer: snappy, but returning from a point glides back.
        const p = pos.current.x < 0 ? want : { x: pos.current.x + (want.x - pos.current.x) * 0.35, y: pos.current.y + (want.y - pos.current.y) * 0.35 };
        next = p;
      }
      const showing = Boolean(g || cursor.current);
      setHere((h) => (h === showing ? h : showing));
      if (next) {
        pos.current = next;
        if (dot.current) dot.current.style.transform = `translate(${next.x}px, ${next.y}px)`;
        const el = bubble.current;
        const h = holds.current;
        if (!h.shown) h.placed = false;
        if (el) {
          const r = el.getBoundingClientRect();
          const size = { width: r.width, height: r.height };
          const view = { width: window.innerWidth, height: window.innerHeight };
          const pillRect = pillSpot.current?.getBoundingClientRect() ?? null;
          // An answer's bubble holds still while the pointer is on it or near it, so the pointer can go
          // onto it (to scroll, to close); a pointer that goes further away takes it along again. It
          // stays by the pointer while the dot flies off to the things the answer points at.
          // (where it was put, not where a glide has got to: `r` moves while the bubble catches up)
          // A bubble that grew (the answer is still being written) is put next to the pointer afresh, so it
          // never grows over the pointer; one the pointer is on stays under it.
          const grew = Math.abs(size.width - h.size.width) >= 1 || Math.abs(size.height - h.size.height) >= 1;
          const hold = h.answer && h.placed && (!grew || h.over) && bubbleSticks(cursor.current, { left: h.at.x, top: h.at.y, right: h.at.x + size.width, bottom: h.at.y + size.height });
          const c = cursor.current;
          // A held bubble is only kept on screen and off the pill as its text grows.
          const at = hold ? bubbleOnScreen(h.at, size, view, pillRect) : bubblePlacement(h.answer && c ? { x: c.x + OFFSET.x, y: c.y + OFFSET.y } : next, size, view, 18, pillRect);
          const want = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
          if (el.style.transform !== want) {
            // An answer's bubble glides when it catches up with the pointer; a first placement does not glide in from where the last bubble was.
            el.style.transitionProperty = h.placed && h.answer ? "" : "opacity, width, height";
            el.style.transform = want;
          }
          const moved = at.x !== h.at.x || at.y !== h.at.y;
          h.at = at;
          h.size = size;
          if (h.shown) h.placed = true;
          // The bubble moved or grew under a pointer that may stand still: look again whether the pointer is on it.
          if (moved || grew) tellHover(cursor.current);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); offs.forEach((o) => o()); if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  }, [reopen, tellHover]);
  /** Labels keep off the pill at the top of the screen. */
  const labelAvoid = useCallback(() => {
    const r = pillSpot.current?.getBoundingClientRect();
    return r && r.width > 0 ? [{ left: r.left, top: r.top, right: r.right, bottom: r.bottom }] : [];
  }, []);
  /** Cards keep off the marks on screen (their strokes and labels), the pill and the answer bubble. */
  const cardAvoid = useCallback(() => {
    const out: Rect[] = [];
    const add = (r: DOMRect | undefined) => { if (r && r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }); };
    document.querySelectorAll(".okf-marks > g.okf-mark:not(.okf-mark--leaving) :is(.okf-mark-ink, .okf-mark-head)").forEach((el) => add(el.getBoundingClientRect()));
    document.querySelectorAll(".okf-marks-over .okf-mark:not(.okf-mark--leaving) .okf-mark-label").forEach((el) => add(el.getBoundingClientRect()));
    add(pillSpot.current?.getBoundingClientRect());
    if (holds.current.shown) add(bubble.current?.getBoundingClientRect());
    return out;
  }, []);
  const markSets = useMemo(() => (leaving ? [leaving, marks] : [marks]), [leaving, marks]);

  // Pause: the pointer's flight and the pen stand still; Resume: they carry on from the same spot.
  useEffect(() => {
    if (pill.paused) clock.current.pause(performance.now());
    else clock.current.resume(performance.now());
  }, [pill.paused]);

  const answering = mode === "thinking" || mode === "speaking";
  // The pill can appear, move or go away under a pointer that stands still (main only says where the
  // pointer is when it moves): look again whenever what is shown changes.
  // Main is told every time (not only on a change): its own record is wiped when the pill goes away.
  const bubbleShown = here && !closed && Boolean(text || stopped || mode === "listening" || mode === "thinking");
  holds.current.answer = answerInBubble(mode, text, stopped && !closed);
  holds.current.shown = bubbleShown;
  useEffect(() => {
    tellHover(cursor.current, true);
  }, [mode, going, here, sees, lang, stopped, pill, keys, text, closed, tellHover]);
  // The sentence being spoken is kept in view, unless the pointer is on the bubble (the user is scrolling it).
  useEffect(() => {
    const box = textBox.current;
    const el = spoken >= 0 ? box?.querySelector<HTMLElement>(`[data-s="${spoken}"]`) : null;
    if (!box || !el || holds.current.over) return;
    const top = followScroll({ top: el.offsetTop, height: el.offsetHeight }, { scrollTop: box.scrollTop, clientHeight: box.clientHeight, scrollHeight: box.scrollHeight });
    if (Math.abs(top - box.scrollTop) > 1) box.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [spoken, text]);
  // More text below what is in view: the room is marked, so its last line fades out (also when the screen's size changes).
  useEffect(() => {
    const mark = () => markMore(textBox.current);
    mark();
    window.addEventListener("resize", mark);
    return () => window.removeEventListener("resize", mark);
  }, [text, bubbleShown]);
  // The stopped pill goes away with the bubble (docs/okfilow/PILL.md).
  const view = pillView({ mode, purpose, stopped: stopped && !closed, pill });
  /** A control of the pill: Stop ends the answer; the eye, Pause and Resume go to the panel through main. */
  const act = (action: PillAction) => {
    const b = okFilowBridge();
    if (action === "stop") b?.stopAnswer?.("button");
    else b?.control?.(action);
  };
  const controls = <AnswerControls pill view={view} t={t} pauseKey={keys.pause} onAction={act} />;
  /** The talk keys are held: a drag marks the screen, from the press on (also while the microphone is still opening). */
  const catching = talkHeld(mode, purpose);
  const onDown = (e: React.PointerEvent) => {
    // The highlighter marks only while the talk keys are held (the only other time a click reaches this window is on the Stop button).
    if (e.button !== 0 || !catching) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    live.current = [[e.clientX, e.clientY]];
    setInk((k) => [...k, live.current!]);
  };
  const onMove = (e: React.PointerEvent) => {
    const l = live.current;
    if (!l) return;
    const last = l[l.length - 1];
    if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 3) return;
    l.push([e.clientX, e.clientY]);
    setInk((k) => [...k.slice(0, -1), [...l]]);
  };
  const onUp = () => {
    const l = live.current;
    live.current = null;
    if (l && l.length > 1) okFilowBridge()?.stroke(l);
  };
  return (
    <>
    <div className={"okf-overlay" + (catching ? " okf-overlay--catch" : "") + (pill.paused ? " okf-paused" : "")} aria-hidden onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {/* Beside the spot they explain, in free space, with a leader to it; opaque from their first frame. */}
      <CardsLayer cards={cards} avoid={cardAvoid} />
      {ink.length > 0 && (
        <svg className="okf-draw okf-ink" width="100%" height="100%">
          {ink.map((l, i) => <polyline key={i} points={l.map((p) => p.join(",")).join(" ")} />)}
        </svg>
      )}
      {/* One drawing layer for the whole life of the overlay: an answer's marks never remount it (no hitch as they arrive). */}
      <MarksLayer sets={markSets} avoid={labelAvoid} />
      <div ref={targetEl} className="okf-point-target" aria-hidden />
      <div ref={dot} className={`okf-buddy okf-buddy--${mode}${going ? " okf-buddy--out" : ""}${here ? "" : " okf-hidden"}`}>
        {going && <span className="okf-out-rings"><i /><i /><i /></span>}
        {/* A 27 px glyph outlined dark inside a light halo: it reads on white and on black. */}
        <svg className="okf-arrow" viewBox="3 2 23 23" width="36" height="36"><path className="okf-arrow-halo" d={ARROW} /><path d={ARROW} /></svg>
        <i ref={ringEl} className="okf-arrival" />
        {label && <span ref={labelEl} className="okf-label">{label}</span>}
      </div>
    </div>
    {/* The bubble is outside the hidden overlay too: its close button is a real button with a name. */}
    <AnswerBubble mode={mode} text={text} stopped={stopped && !closed} shown={bubbleShown} level={level} spoken={spoken} t={t} onClose={() => okFilowBridge()?.closeBubble?.()} bubbleRef={bubble} textRef={textBox} />
    {/* The pill is outside the hidden overlay: its controls are real buttons with names. The window never takes the
        keyboard (it must not take it from the app in use), so keys reach them through the panel and the two shortcuts.
        Going outside wins over the other pills, and shows on every display: it must not be missed. */}
    {going ? (
      <div ref={pillSpot} className="okf-notch okf-notch--out" role="group" aria-label="OK Filow">
        <OutboundIcon />
        <strong>{t("outLabel")}</strong>
        <span>{t("outSending").replace("{names}", joinNames(localNames(out.names, t("freeName")), t("outAnd")))}</span>
        {/* An answer from online can be paused and stopped from here too. */}
        {answering && controls}
      </div>
    ) : here && view.show && (
      <div ref={pillSpot} className="okf-notch" role="group" aria-label="OK Filow" data-testid="okf-pill">
        {/* The eye as it is now (what the next question would do), in a word too; a click opens or closes it. */}
        {view.eye ? <EyeButton open={pill.sees} t={t} keyLabel={keys.eye} onToggle={() => act("eye")} /> : <span className={"okf-notch-dot okf-notch-dot--" + mode} />}
        <Slot className="okf-notch-status" show={view.status} labels={statusRoom(view.status).map((k) => ({ key: k, text: t(k) }))} />
        {controls}
      </div>
    )}
    {/* Dictation's start and end for screen readers (outside the hidden overlay), from the display with the mouse only. */}
    <div className="okf-sr" role="status" aria-live="polite">
      {here && purpose === "dictate" && mode === "listening" ? dictationText(lang, "startedLive") : ""}
    </div>
    </>
  );
}
