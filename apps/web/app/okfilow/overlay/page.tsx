"use client";
// OK Filow overlay: one transparent, click-through window per display. Draws the buddy dot next to
// the mouse, the waveform while listening, a spinner while thinking, the answer bubble, and flies
// the dot along a curve to the things the answer points at.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@filow/ui";
import { okFilowBridge, type OkFilowCard, type OkFilowMode } from "@/lib/buddy/bridge";
import { bezierPoint, bubblePlacement, createPausableClock, marksStarted, overControls, STROKE_GAP_MS } from "@/lib/buddy/motion";
import { keyLabel, PILL_IDLE, pillView, statusRoom, type PillAction, type PillState } from "@/lib/buddy/pill";
import { AnswerControls, EyeButton, Slot } from "@/components/okfilow/controls";
import { joinNames, localNames, type OutboundSnapshot } from "@/lib/buddy/outbound";
import type { BuddyMark } from "@/lib/buddy/prompt";
import { okfText, type OkfKey } from "@/lib/buddy/text";
import { dictationText } from "@/lib/dictation/text";
import { OutboundIcon } from "../outbound-ui";
import "../okfilow.css";

const OFFSET = { x: 16, y: 20 };
const FLY_MS = 650;
const HOLD_MS = 5500;

/** SVG path for one mark, drawn like a quick pen stroke (circles are slightly open ellipses). */
function markPath(m: BuddyMark): string {
  switch (m.kind) {
    case "circle": {
      const rx = m.r * 1.12;
      const ry = m.r * 0.92;
      const pts = Array.from({ length: 41 }, (_, i) => {
        const a = -2.2 + (i / 40) * Math.PI * 2.12;
        const wob = 1 + 0.035 * Math.sin(i * 1.7);
        return `${(m.x + Math.cos(a) * rx * wob).toFixed(1)},${(m.y + Math.sin(a) * ry * wob).toFixed(1)}`;
      });
      return "M" + pts.join(" L");
    }
    case "underline": {
      const mid = (m.x1 + m.x2) / 2;
      return `M${m.x1},${m.y + 2} Q${mid},${m.y - 3} ${m.x2},${m.y + 1}`;
    }
    case "box": {
      const p = 6;
      return `M${m.x1 - p},${m.y1 - p} L${m.x2 + p},${m.y1 - p + 2} L${m.x2 + p - 1},${m.y2 + p} L${m.x1 - p + 2},${m.y2 + p - 1} Z`;
    }
    case "arrow": {
      const ang = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
      const head = 16;
      const l = { x: m.x2 - head * Math.cos(ang - 0.45), y: m.y2 - head * Math.sin(ang - 0.45) };
      const r = { x: m.x2 - head * Math.cos(ang + 0.45), y: m.y2 - head * Math.sin(ang + 0.45) };
      const bend = { x: (m.x1 + m.x2) / 2 - (m.y2 - m.y1) * 0.12, y: (m.y1 + m.y2) / 2 + (m.x2 - m.x1) * 0.12 };
      return `M${m.x1},${m.y1} Q${bend.x},${bend.y} ${m.x2},${m.y2} M${l.x},${l.y} L${m.x2},${m.y2} L${r.x},${r.y}`;
    }
  }
}

/** Where a mark's label sits: just outside the shape, below-right. */
function labelAt(m: BuddyMark): { x: number; y: number } {
  switch (m.kind) {
    // Above the circle: the answer bubble usually sits below the buddy, so a label below would collide.
    case "circle": return { x: m.x + m.r * 0.6, y: Math.max(4, m.y - m.r - 30) };
    case "underline": return { x: m.x1, y: m.y + 10 };
    case "box": return { x: m.x1, y: Math.max(m.y1, m.y2) + 12 };
    case "arrow": return { x: m.x1, y: m.y1 + 10 };
  }
}

type Target = { x: number; y: number; label: string };

export default function OkFilowOverlay() {
  const dot = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<OkFilowMode>("idle");
  const [purpose, setPurpose] = useState("talk");
  // This question took the screen with it (the eye on the pill), and the answer on screen was stopped by the user.
  const [sees, setSees] = useState(true);
  const [stopped, setStopped] = useState(false);
  const marksAt = useRef(0);
  // The pill: its state (the eye now, paused, resumable: the panel says), its shortcuts, and whether the pointer is on one of its controls.
  const [pill, setPill] = useState<PillState>(PILL_IDLE);
  const [keys, setKeys] = useState({ eye: "", pause: "" });
  const pillSpot = useRef<HTMLDivElement>(null);
  const overStop = useRef(false);
  /** The flights and the pen are timed on this clock: it stands still while the answer is paused. */
  const clock = useRef(createPausableClock());
  /** Whether the pointer is on a control of the pill (the eye, Pause, Resume, Stop). */
  const onControl = useCallback((p: { x: number; y: number } | null) => overControls(p, Array.from(pillSpot.current?.querySelectorAll("button") ?? [], (el) => el.getBoundingClientRect())), []);
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const [label, setLabel] = useState("");
  // Near the bottom or right edge the label goes above or to the left of the arrow, never off screen.
  const [flip, setFlip] = useState("");
  const [here, setHere] = useState(false);
  // `done`: drawn before a stop (Resume after Stop): shown as it was, not drawn again.
  const [marks, setMarks] = useState<{ id: number; list: Array<BuddyMark & { done?: boolean }> }>({ id: 0, list: [] });
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
  const flight = useRef<{ from: { x: number; y: number }; to: Target; start: number; holdUntil: number } | null>(null);

  useEffect(() => {
    const b = okFilowBridge();
    if (!b) return;
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
        if (s.stopped === true) {
          // Stop: the pointer flies nowhere else, and the marks not yet begun are not drawn (the ones on screen stay).
          queue.current = [];
          flight.current = null;
          setLabel("");
          const elapsed = clock.current.at(performance.now()) - marksAt.current;
          setMarks((m) => {
            const before = m.list.filter((x) => x.done).length;
            return { id: m.id, list: m.list.slice(0, before + marksStarted(m.list.length - before, elapsed, STROKE_GAP_MS)) };
          });
        }
        if (s.mode !== "listening" && live.current) {
          const l = live.current;
          live.current = null;
          if (l.length > 1) b.stroke(l);
        }
        // The marks go away once the answer is on its way; the model already has them in the screenshot.
        if (s.mode === "speaking" || s.mode === "idle" || s.mode === "error") setInk([]);
      }),
      b.onText(setText),
      b.outbound?.onChange(setOut) ?? (() => {}),
      b.onLevel(setLevel),
      b.onCursor((p) => {
        cursor.current = p;
        // The controls of the pill are the one thing here that takes a click: while the pointer is on
        // one (main sends where the pointer is), this overlay asks main for the mouse, and gives it back after.
        const over = onControl(p);
        if (over !== overStop.current) {
          overStop.current = over;
          b.overlayHover?.(over);
        }
      }),
      b.onDraw((list) => {
        // Kept until main sends okfilow:clear (Escape, the panel's Clear, or the next question).
        marksAt.current = clock.current.at(performance.now());
        setMarks((m) => ({ id: m.id + 1, list: Array.isArray(list) ? list : [] }));
      }),
      b.onCards((list) => setCards(Array.isArray(list) ? list.slice(0, 2) : [])),
      b.onClear(() => {
        setCards([]);
        setMarks((m) => (m.list.length ? { id: m.id + 1, list: [] } : m));
        queue.current = [];
        flight.current = null;
        setLabel("");
      }),
      b.onPoint((points) => {
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
        const to = queue.current.shift()!;
        const from = pos.current.x < 0 ? { x: to.x - 120, y: to.y - 120 } : { ...pos.current };
        flight.current = { from, to, start: now, holdUntil: now + FLY_MS + HOLD_MS };
      }
      const g = flight.current;
      let next: { x: number; y: number } | null = null;
      if (g) {
        const k = Math.min(1, (now - g.start) / FLY_MS);
        next = bezierPoint(g.from, g.to, k);
        if (k >= 1) {
          setLabel((l) => (l === g.to.label ? l : g.to.label));
          const f = (g.to.y > window.innerHeight - 56 ? " okf-label--up" : "") + (g.to.x > window.innerWidth - 240 ? " okf-label--left" : "");
          setFlip((v) => (v === f ? v : f));
        }
        if (now > g.holdUntil || (queue.current.length && now > g.start + FLY_MS + 1800)) { flight.current = null; setLabel(""); }
      } else if (cursor.current) {
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
        if (bubble.current) {
          const r = bubble.current.getBoundingClientRect();
          const at = bubblePlacement(next, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight });
          bubble.current.style.transform = `translate(${at.x}px, ${at.y}px)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); offs.forEach((o) => o()); };
  }, [onControl]);

  // Pause: the pointer's flight and the pen stand still; Resume: they carry on from the same spot.
  useEffect(() => {
    if (pill.paused) clock.current.pause(performance.now());
    else clock.current.resume(performance.now());
  }, [pill.paused]);

  const bars = [0.55, 0.85, 1, 0.8, 0.5];
  const answering = mode === "thinking" || mode === "speaking";
  // The pill can appear, move or go away under a pointer that stands still (main only says where the
  // pointer is when it moves): look again whenever what is shown changes.
  // Main is told every time (not only on a change): its own record is wiped when the pill goes away.
  useEffect(() => {
    const over = onControl(cursor.current);
    overStop.current = over;
    okFilowBridge()?.overlayHover?.(over);
  }, [mode, going, here, sees, lang, stopped, pill, keys, onControl]);
  const view = pillView({ mode, purpose, stopped, pill });
  /** A control of the pill: Stop ends the answer; the eye, Pause and Resume go to the panel through main. */
  const act = (action: PillAction) => {
    const b = okFilowBridge();
    if (action === "stop") b?.stopAnswer?.("button");
    else b?.control?.(action);
  };
  const controls = <AnswerControls pill view={view} t={t} pauseKey={keys.pause} onAction={act} />;
  const drawnBefore = marks.list.filter((m) => m.done).length;
  const onDown = (e: React.PointerEvent) => {
    // The highlighter marks only while the talk keys are held (the only other time a click reaches this window is on the Stop button).
    if (e.button !== 0 || !(mode === "listening" && purpose === "talk")) return;
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
    <div className={"okf-overlay" + (mode === "listening" && purpose === "talk" ? " okf-overlay--catch" : "") + (pill.paused ? " okf-paused" : "")} aria-hidden onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {cards.length > 0 && (() => {
        // A column beside the spot the first card explains; the cards stack by their real heights,
        // and the column is kept on screen (it scrolls inside itself only if it is taller).
        const w = 260;
        const est = cards.reduce((sum, c) => sum + (c.photo ? 270 : 130) + 12, 0);
        const left = Math.min(Math.max(8, cards[0].x + 24), window.innerWidth - w - 8);
        const top = Math.min(Math.max(8, cards[0].y - 40), Math.max(8, window.innerHeight - est - 8));
        return (
          <div className="okf-cards" style={{ left, top, width: w, maxHeight: window.innerHeight - top - 8 }}>
            {cards.map((c, i) => (
              <article key={i} className="okf-card" style={{ animationDelay: `${300 + i * 400}ms` }}>
                {c.photo && <img src={c.photo} alt="" />}
                <div>
                  {c.title && <strong>{c.title}</strong>}
                  {c.text}
                </div>
              </article>
            ))}
          </div>
        );
      })()}
      {ink.length > 0 && (
        <svg className="okf-draw okf-ink" width="100%" height="100%">
          {ink.map((l, i) => <polyline key={i} points={l.map((p) => p.join(",")).join(" ")} />)}
        </svg>
      )}
      {marks.list.length > 0 && (
        <svg key={marks.id} className="okf-draw" width="100%" height="100%">
          {marks.list.map((m, i) => (
            <g key={i} className={"okf-mark" + (m.done ? " okf-mark--done" : "")} style={{ animationDelay: `${(i - drawnBefore) * STROKE_GAP_MS}ms` }}>
              <path d={markPath(m)} pathLength={1} style={{ animationDelay: `${(i - drawnBefore) * STROKE_GAP_MS}ms` }} />
              {m.label && (
                <foreignObject x={labelAt(m).x} y={labelAt(m).y} width="240" height="40">
                  <span className="okf-mark-label" style={{ animationDelay: `${(i - drawnBefore) * STROKE_GAP_MS + 450}ms` }}>{m.label}</span>
                </foreignObject>
              )}
            </g>
          ))}
        </svg>
      )}
      <div ref={dot} className={`okf-buddy okf-buddy--${mode}${going ? " okf-buddy--out" : ""}${here ? "" : " okf-hidden"}`}>
        {going && <span className="okf-out-rings"><i /><i /><i /></span>}
        <svg className="okf-arrow" viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l17 8-7.5 2.2L10.4 20z" /></svg>
        {label && <span className={"okf-label" + flip}>{label}</span>}
      </div>
      <div ref={bubble} className={`okf-bubble${here && (text || stopped || mode === "listening" || mode === "thinking") ? "" : " okf-hidden"}${mode === "error" ? " okf-bubble--error" : ""}`}>
        {mode === "listening" && (
          <span className="okf-wave">{bars.map((b, i) => <i key={i} style={{ height: `${4 + Math.round(level * b * 18)}px` }} />)}</span>
        )}
        {mode === "thinking" && <span className="okf-spin" />}
        {text && <span className="okf-text">{text}</span>}
        {/* What was said stays, marked: the user stopped it, nothing went wrong. */}
        {stopped && <span className="okf-bubble-stopped">{t("stopped")}</span>}
      </div>
    </div>
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
